using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using System.Web.Script.Serialization;

public static class DesktopFakeNode
{
    [DllImport("kernel32.dll")]
    private static extern IntPtr GetConsoleWindow();

    public static int Main(string[] args)
    {
        File.WriteAllText(Environment.GetEnvironmentVariable("SENTIENT_TEST_REPORT"),
            new JavaScriptSerializer().Serialize(new {
                args = args,
                cwd = Environment.CurrentDirectory,
                console = GetConsoleWindow().ToInt64()
            }));
        string release = Environment.GetEnvironmentVariable("SENTIENT_TEST_RELEASE");
        if (!String.IsNullOrEmpty(release))
        {
            Stopwatch deadline = Stopwatch.StartNew();
            while (!File.Exists(release) && deadline.ElapsedMilliseconds < 10000) Thread.Sleep(20);
            if (!File.Exists(release)) return 2;
        }
        if (Environment.GetEnvironmentVariable("SENTIENT_TEST_LARGE_OUTPUT") == "1")
        {
            Console.Error.Write("PORT_IN_USE: synthetic diagnostic\n");
            Console.Out.Write(new string('x', 1048576));
            Console.Error.Write(new string('x', 1048576));
        }
        else Console.Error.Write(Environment.GetEnvironmentVariable("SENTIENT_TEST_ERROR"));
        return Int32.Parse(Environment.GetEnvironmentVariable("SENTIENT_TEST_EXIT") ?? "0");
    }
}
