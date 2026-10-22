using System;
using System.Collections.Generic;
using System.IO;
using System.Web.Script.Serialization;

public static class DesktopLauncherProbe
{
    public static int Main(string[] args)
    {
        var notifications = new List<string>();
        int code = DesktopLauncher.Run(args, AppDomain.CurrentDomain.BaseDirectory,
            message => notifications.Add(message));
        File.WriteAllText(Environment.GetEnvironmentVariable("SENTIENT_TEST_NOTIFICATION"),
            new JavaScriptSerializer().Serialize(notifications));
        return code;
    }
}
