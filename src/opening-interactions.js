/** One shared grab owner for the warehouse, equipment and assembly bench. */
export function createOpeningInteractions(base,puzzles,assembly){
  const systems=[puzzles,assembly,base];
  const active=()=>systems.find(s=>s.getGrabState().active)||base;
  const owner=mesh=>puzzles.owns(mesh)?puzzles:assembly.owns(mesh)?assembly:base;
  const busy=()=>systems.some(s=>s.getGrabState().active);
  return {
    get targets(){return [...base.targets,...puzzles.targets,...assembly.targets];},
    get grabTargets(){return [...base.grabTargets,...puzzles.grabTargets,...assembly.grabTargets];},
    get occluders(){return base.occluders;},
    beginGrab(mesh,point,handId,context){return !busy()&&owner(mesh).beginGrab(mesh,point,handId,context);},
    moveGrab:(point,handId)=>active().moveGrab(point,handId),
    endGrab:(handId,options)=>active().endGrab(handId,options),
    getGrabState:()=>active().getGrabState(),
    hit:(mesh,point,direction)=>!busy()&&owner(mesh)===base&&base.hit(mesh,point,direction),
    nudge:(mesh,point,direction,strength)=>!busy()&&owner(mesh)===base&&base.nudge(mesh,point,direction,strength),
    cancelGrabs(){const grab=active().getGrabState();return grab.active&&active().endGrab(grab.handId,{cancelled:true});},
    step(dt){base.step(dt);puzzles.step(dt);assembly.step(dt);},
    getState:()=>({...base.getState(),opening:puzzles.getState(),mechanism:assembly.getState(),grab:(()=>{const{heldMesh,...rest}=active().getGrabState();return rest;})()}),
    getObstacles:()=>[...base.getObstacles(),...puzzles.getObstacles(),...assembly.getObstacles()],
    restore(){base.restore();puzzles.reset();assembly.reset();},
    dispose(){puzzles.dispose();assembly.dispose();base.dispose();},
  };
}
