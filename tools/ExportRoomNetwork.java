// Static inference only; does not execute the original module.
//@category Chessmaster
import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.*;
import ghidra.program.model.listing.*;
import java.io.*;
public class ExportRoomNetwork extends GhidraScript {
 public void run() throws Exception {
  DecompInterface dc=new DecompInterface();dc.openProgram(currentProgram);
  try(PrintWriter out=new PrintWriter(new FileWriter(getScriptArgs()[0]))){
   out.println("/* Inferred Ghidra pseudocode, not original source. MPG exported entry points only. */");
   int count=0;
   for(Function f:currentProgram.getFunctionManager().getFunctions(true)){
    if(f.isExternal()||!f.getName().matches(".*MPG_.*"))continue;
    monitor.checkCancelled();if(++count>24){out.println("/* Bounded selection: first 24 exports. */");break;}
    out.println("\n/* "+f.getName()+" at "+f.getEntryPoint()+" */");
    DecompileResults r=dc.decompileFunction(f,20,monitor);
    if(r.decompileCompleted())out.println(r.getDecompiledFunction().getC().replaceAll("(?m)[ \\t]+$","").stripTrailing());
    else out.println("/* Incomplete: "+r.getErrorMessage().replace("*/","")+" */");
   }
  }finally{dc.dispose();}
 }
}
