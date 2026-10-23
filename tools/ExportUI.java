// Static UI evidence only. Never executed original Windows code.
//@category Chessmaster
import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.*;
import ghidra.program.model.listing.*;
import ghidra.program.model.symbol.*;
import java.io.*;
import java.util.*;

public class ExportUI extends GhidraScript {
    public void run() throws Exception {
        Set<Function> selected = new LinkedHashSet<>();
        String pattern = "(?i)(PTR_)?(cmLoadMenu|cmSetMenu|cmTrackPopupMenu|cguiFindFont|cguiFontInit|cguiRegisterFont|LoadMenuA" +
            (getScriptArgs().length > 1 && getScriptArgs()[1].equals("menu") ? "" : "|DialogBoxParam|CreateDialogParam") + ")(_[0-9a-f]+)?";
        try (PrintWriter out = new PrintWriter(new FileWriter(getScriptArgs()[0]))) {
            out.println("/* Inferred Ghidra pseudocode; not original source. Static selection by menu/dialog/font symbols. */");
            for (Symbol symbol : currentProgram.getSymbolTable().getAllSymbols(true)) {
                if (!symbol.getName().matches(pattern)) continue;
                out.println("/* Symbol " + symbol.getName() + " at " + symbol.getAddress() + " */");
                Function self = getFunctionAt(symbol.getAddress());
                if (self != null && !self.isExternal()) selected.add(self);
                for (Reference ref : getReferencesTo(symbol.getAddress())) {
                    Function caller = getFunctionContaining(ref.getFromAddress());
                    if (caller != null && !caller.isExternal()) {
                        if (caller.isThunk()) {
                            for (Reference call : getReferencesTo(caller.getEntryPoint())) {
                                Function f = getFunctionContaining(call.getFromAddress());
                                if (f != null && !f.isExternal()) selected.add(f);
                            }
                        } else selected.add(caller);
                    }
                }
            }
            DecompInterface dc = new DecompInterface(); dc.openProgram(currentProgram);
            try {
                int count=0;
                for (Function f : selected) {
                    monitor.checkCancelled();
                    if (++count > 40) { out.println("/* Selection bounded to first 40 functions. */"); break; }
                    out.println("\n/* " + f.getName() + " at " + f.getEntryPoint() + " */");
                    DecompileResults result=dc.decompileFunction(f,20,monitor);
                    if (result.decompileCompleted()) out.println(result.getDecompiledFunction().getC());
                    else out.println("/* Incomplete: " + result.getErrorMessage().replace("*/", "") + " */");
                }
            } finally { dc.dispose(); }
        }
    }
}
