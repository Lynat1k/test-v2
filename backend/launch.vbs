Set WshShell = CreateObject("Wscript.Shell")
WshShell.CurrentDirectory = "D:\PROCLUSTER2\procluster\backend"
WshShell.Run "D:\PROCLUSTER2\procluster\backend\procluster.exe", 0, False
