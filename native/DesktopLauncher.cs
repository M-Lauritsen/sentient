using System;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading.Tasks;
using System.Windows.Forms;

public static class DesktopLauncher
{
    [STAThread]
    public static int Main(string[] args)
    {
        return Run(args, AppDomain.CurrentDomain.BaseDirectory, delegate(string message)
        {
            MessageBox.Show(message, "SENTIENT launcher", MessageBoxButtons.OK, MessageBoxIcon.Error);
        });
    }

    public static int Run(string[] args, string executableDirectory, Action<string> notify)
    {
        if (args.Length != 1)
            return Fail(notify, "NODE_UNAVAILABLE: Set the shortcut argument to the quoted absolute path of node.exe.");

        try
        {
            string node = args[0];
            if (!Path.IsPathRooted(node) ||
                !String.Equals(Path.GetFullPath(node), node, StringComparison.OrdinalIgnoreCase) ||
                !String.Equals(Path.GetFileName(node), "node.exe", StringComparison.OrdinalIgnoreCase) ||
                !File.Exists(node))
                return Fail(notify, "NODE_UNAVAILABLE: Select an existing node.exe using its absolute path.");

            string checkout = Path.GetFullPath(Path.Combine(executableDirectory, "..", ".."));
            string script = Path.Combine(checkout, "desktop", "launch.mjs");
            if (!File.Exists(script))
                return Fail(notify, "CHECKOUT_UNAVAILABLE: Keep this executable in the checkout's native\\bin folder.");

            using (Process child = new Process())
            {
                child.StartInfo = new ProcessStartInfo
                {
                    FileName = node,
                    Arguments = "\"" + script + "\" --browser brave",
                    WorkingDirectory = checkout,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    RedirectStandardInput = true,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true
                };
                child.Start();
                child.StandardInput.Close();
                Task<string> errors = Task.Factory.StartNew(() => Drain(child.StandardError, 8192));
                Task<string> output = Task.Factory.StartNew(() => Drain(child.StandardOutput, 0));
                child.WaitForExit();
                Task.WaitAll(errors, output);
                if (child.ExitCode == 0) return 0;
                return Fail(notify, FailureMessage(errors.Result));
            }
        }
        catch (Win32Exception)
        {
            return Fail(notify, "START_FAILED: Windows could not start node.exe. Check the shortcut target and Node installation.");
        }
        catch (IOException)
        {
            return Fail(notify, "START_FAILED: The launcher could not read its checkout or Node process output.");
        }
        catch (UnauthorizedAccessException)
        {
            return Fail(notify, "START_FAILED: Access to this checkout or node.exe was denied.");
        }
        catch (ArgumentException)
        {
            return Fail(notify, "NODE_UNAVAILABLE: Use a valid absolute path to node.exe.");
        }
        catch (AggregateException)
        {
            return Fail(notify, "START_FAILED: The launcher could not drain its Node process output.");
        }
    }

    private static string Drain(StreamReader reader, int limit)
    {
        char[] buffer = new char[2048];
        StringBuilder value = new StringBuilder();
        int count;
        while ((count = reader.Read(buffer, 0, buffer.Length)) != 0)
        {
            int keep = Math.Min(count, limit - value.Length);
            if (keep > 0) value.Append(buffer, 0, keep);
        }
        return value.ToString();
    }

    private static string FailureMessage(string errors)
    {
        string code = errors.Split(':')[0];
        switch (code)
        {
            case "PORT_IN_USE":
                return "PORT_IN_USE: Close your existing SENTIENT launcher or stop your manually started server, then try again. No existing listener was adopted or stopped.";
            case "BROWSER_UNAVAILABLE":
            case "APP_ACTIVATION_UNAVAILABLE":
            case "BROWSER_LAUNCH_FAILED":
                return code + ": Check the installed SENTIENT OS app and its Brave shortcut/profile.";
            case "NO_PARTICIPATING_WINDOW":
                return code + ": No app page registered within 120 seconds. Reopen the installed Brave app and check its backend connection.";
            case "USAGE":
            case "UNSUPPORTED_PLATFORM":
            case "NODE_VERSION":
            case "CHECKOUT_UNAVAILABLE":
            case "START_FAILED":
            case "READY_TIMEOUT":
            case "OWNERSHIP_LOST":
            case "CLEANUP_FAILED":
                return code + ": Run node desktop\\launch.mjs from the checkout in a terminal for recovery guidance.";
            default:
                return "START_FAILED: Run node desktop\\launch.mjs from the checkout in a terminal for recovery guidance.";
        }
    }

    private static int Fail(Action<string> notify, string message)
    {
        notify(message);
        return 1;
    }
}
