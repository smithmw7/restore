/** Share one hand/drag owner across movable props and tethered light fixtures. */
export function createSceneInteractions(game, hangingLights) {
  const isLight = mesh => mesh?.userData.kind === 'hanging-light';
  const active = () => hangingLights.getGrabState().active ? hangingLights : game;
  const busy = () => game.getGrabState().active || hangingLights.getGrabState().active;
  return {
    get targets() { return [...game.targets, ...hangingLights.targets]; },
    get grabTargets() { return [...game.grabTargets, ...hangingLights.grabTargets]; },
    get occluders() { return game.occluders; },
    beginGrab(mesh, point, handId) {
      if (busy()) return false;
      return (isLight(mesh) ? hangingLights : game).beginGrab(mesh, point, handId);
    },
    moveGrab: (point, handId) => active().moveGrab(point, handId),
    endGrab: (handId, options) => active().endGrab(handId, options),
    cancelGrabs() {
      const state = active().getGrabState();
      return state.active ? active().endGrab(state.handId, { cancelled: true }) : false;
    },
    hit(mesh, point, direction) {
      if (busy()) return false;
      return (isLight(mesh) ? hangingLights : game).hit(mesh, point, direction);
    },
    nudge(mesh, point, direction, strength) {
      if (busy()) return false;
      return (isLight(mesh) ? hangingLights : game).nudge(mesh, point, direction, strength);
    },
    getGrabState: () => active().getGrabState(),
    getState() {
      const { heldMesh, ...grab } = active().getGrabState();
      return { ...game.getState(), grab, hangingLights: hangingLights.getState() };
    },
    getObstacles: () => game.getObstacles(),
    // The warehouse owns the light simulation so its spots and fog update in
    // the same order. Prop physics remains in its existing fixed-step world.
    step: dt => game.step(dt),
    restore() {
      hangingLights.reset();
      return game.restore();
    },
    dispose: () => game.dispose(),
  };
}
