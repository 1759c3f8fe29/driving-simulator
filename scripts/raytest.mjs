/**
 * raytest — one-off check: does a Rapier raycast see a freshly-created trimesh
 * collider before world.step() has run once? CityLoader.findSpawnPoint and the
 * ambient-prop placement both raycast immediately after the boot chunks build,
 * so if the query structures are only refreshed during step(), every probe
 * misses and props/spawn silently fall back.
 */

const RAPIER = (await import('@dimforge/rapier3d-compat')).default;
await RAPIER.init();

const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
const verts = new Float32Array([-10, 0, -10, 10, 0, -10, 10, 0, 10, -10, 0, 10]);
const idx = new Uint32Array([0, 1, 2, 0, 2, 3]);
world.createCollider(RAPIER.ColliderDesc.trimesh(verts, idx), body);

const cast = () =>
  world.castRayAndGetNormal(new RAPIER.Ray({ x: 0, y: 50, z: 0 }, { x: 0, y: -1, z: 0 }), 200, true);

const before = cast();
console.log('hit BEFORE step:', before ? before.timeOfImpact : null);

// Cheaper candidate fix than a full step: refresh only the query structures.
world.queryPipeline.update(world.colliders);
const afterQuery = cast();
console.log('hit AFTER  queryPipeline.update:', afterQuery ? afterQuery.timeOfImpact : null);

world.step();
const after = cast();
console.log('hit AFTER  step:', after ? after.timeOfImpact : null);
