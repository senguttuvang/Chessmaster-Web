// Inferred static evidence. Never original source; never executes the game.
//@category Chessmaster
import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.*;
import ghidra.program.model.listing.*;
import ghidra.program.model.symbol.*;
import java.io.*;
import java.util.*;

public class ExportAudio extends GhidraScript {
 public void run() throws Exception {
  Set<Function> selected=new LinkedHashSet<>();
  boolean all=getScriptArgs().length>1 && getScriptArgs()[1].equals("all");
  if(all){
   for(Function f:currentProgram.getFunctionManager().getFunctions(true))
    if(!f.isExternal()&&!f.isThunk() && f.getEntryPoint().getOffset()<0x10001e21L)selected.add(f);
  }else{
   for(Function f:currentProgram.getFunctionManager().getFunctions(true)){
    long address=f.getEntryPoint().getOffset();
    if(!f.isExternal() && ((address>=0x00507700L && address<0x00509500L) ||
                          (address>=0x00424000L && address<0x00424a00L)))selected.add(f);
   }
   for(Symbol symbol:currentProgram.getSymbolTable().getAllSymbols(true)){
    if(!symbol.getName().matches("(?i).*(_AIL_set_sample_type|_AIL_set_named_sample_file|_AIL_set_sample_playback_rate|_AIL_decompress_ASI|datLoadItem|PlaySoundA).*"))continue;
    for(Reference ref:getReferencesTo(symbol.getAddress())){
     Function caller=getFunctionContaining(ref.getFromAddress());
     if(caller==null||caller.isExternal())continue;
     if(caller.isThunk()){
      for(Reference call:getReferencesTo(caller.getEntryPoint())){
       Function f=getFunctionContaining(call.getFromAddress());
       if(f!=null&&!f.isExternal())selected.add(f);
      }
     }else selected.add(caller);
    }
   }
  }
  DecompInterface dc=new DecompInterface();dc.openProgram(currentProgram);
  try(PrintWriter out=new PrintWriter(new FileWriter(getScriptArgs()[0]))){
   out.println("/* Inferred Ghidra pseudocode, not original source. Audio/DAT static selection. */");
   for(Function f:selected){
    monitor.checkCancelled();out.println("\n/* "+f.getName()+" at "+f.getEntryPoint()+" */");
    DecompileResults r=dc.decompileFunction(f,30,monitor);
    if(!r.decompileCompleted())throw new IOException(f.getName()+": "+r.getErrorMessage());
    out.println(r.getDecompiledFunction().getC().replaceAll("(?m)[ \\t]+$", "").stripTrailing());
   }
   out.println("/* Exported "+selected.size()+" functions. */");
  }finally{dc.dispose();}
 }
}
