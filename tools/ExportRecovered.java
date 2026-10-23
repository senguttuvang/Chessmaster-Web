// Ghidra evidence export. This is inferred pseudocode, not the original source.
//@category Chessmaster
import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.*;
import ghidra.program.model.listing.*;
import java.io.*;

public class ExportRecovered extends GhidraScript {
    public void run() throws Exception {
        DecompInterface decompiler = new DecompInterface();
        decompiler.openProgram(currentProgram);
        try (PrintWriter out = new PrintWriter(new BufferedWriter(new FileWriter(getScriptArgs()[0])))) {
            out.println("/* Recovered Ghidra pseudocode. Original variable names and types are unknown. */");
            for (Function function : currentProgram.getFunctionManager().getFunctions(true)) {
                if (function.isExternal()) continue;
                monitor.checkCancelled();
                DecompileResults result = decompiler.decompileFunction(function, 15, monitor);
                out.println("\n/* Address " + function.getEntryPoint() + " */");
                if (result.decompileCompleted()) out.println(result.getDecompiledFunction().getC().replaceAll("(?m)[ \\t]+$", ""));
                else out.println("/* Decompilation incomplete: " + result.getErrorMessage().replace("*/", "") + " */");
            }
        } finally { decompiler.dispose(); }
    }
}
