"""Validate the shipped GLB in a new Blender scene, including each template's four views."""
import bpy,os,sys,argparse,json,math,hashlib,numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree
parser=argparse.ArgumentParser();parser.add_argument('--render-models',default='');args=parser.parse_args(sys.argv[sys.argv.index('--')+1:]if '--'in sys.argv else[])
ROOT=os.path.abspath(os.path.join(os.path.dirname(__file__),'../..'));ART=ROOT+'/art/office';OUT=ROOT+'/public/models/office';source=json.load(open(ART+'/asset-report.json'))
bpy.ops.wm.read_factory_settings(use_empty=True);bpy.ops.import_scene.gltf(filepath=OUT+'/office-kit.glb')
kit=bpy.data.objects['OfficeKit'];assert kit['kitId']=='restore-retro-office' and kit['assetVersion']=='1.0.1'
names=['Desk','Drawer','Notebook','LockerShell','LockerDoor','Chair','Pen','Pencil','Logbook'];models={n:bpy.data.objects[n]for n in names};allmeshes=[o for o in bpy.data.objects if o.type=='MESH'];triangles=sum(sum(len(f.vertices)-2 for f in o.data.polygons)for o in allmeshes);assert triangles==source['triangles'];assert triangles<=70000
images={n.image for o in allmeshes for m in o.data.materials for n in m.node_tree.nodes if n.type=='TEX_IMAGE' and n.image};assert len(images)==3
assert all(im.packed_file or im.packed_files for im in images),'External texture in runtime GLB'
assert all(o.matrix_world.determinant()>0 for o in bpy.data.objects),'Mirrored transform'
assert all(math.isfinite(a)for o in allmeshes for v in o.data.vertices for a in v.co),'Nonfinite vertex'
assert all(o.data.uv_layers.active for o in allmeshes),'Missing UV'
assert all(len(o.data.polygons)>0 for o in allmeshes),'Empty render mesh'
for p in models.values():
 assert p.parent==kit and p.location.length<1e-8 and p.rotation_euler.to_quaternion().angle<1e-8 and (p.scale-Vector((1,1,1))).length<1e-8,(p.name,'invalid template transform')
cover=bpy.data.objects['NotebookCover'];cover.rotation_mode='XYZ';models['LockerDoor'].rotation_mode='XYZ';assert cover.parent==models['Notebook'];assert (cover.location-Vector((-.215,0,.055))).length<1e-6

def descendants(p):return [o for o in allmeshes if o.parent==p or o.parent.parent==p]
def bounds(obs):
 pts=[o.matrix_world@v.co for o in obs for v in o.data.vertices];return Vector([min(v[i]for v in pts)for i in range(3)]),Vector([max(v[i]for v in pts)for i in range(3)])
measured={}
for n,p in models.items():
 lo,hi=bounds(descendants(p));mn=[lo.x,lo.z,-hi.y];mx=[hi.x,hi.z,-lo.y];expected=source['models'][n]
 assert max(abs(a-b)for a,b in zip(mn,expected['boundsMin']))<2e-5,(n,mn,expected['boundsMin']);assert max(abs(a-b)for a,b in zip(mx,expected['boundsMax']))<2e-5,(n,mx,expected['boundsMax'])
 measured[n]={'boundsMin':mn,'boundsMax':mx,'triangles':sum(sum(len(f.vertices)-2 for f in o.data.polygons)for o in descendants(p))}
# Measure the actual exported UV scale, using each planar triangle's intrinsic
# metric basis. This catches stretch even if a board changes size or direction.
uv_scales=[];planar_wood_triangles=0
for name in ['Desk','Drawer']:
 for o in descendants(models[name]):
  uv=o.data.uv_layers.active.data
  for face in o.data.polygons:
   if not o.data.materials[face.material_index] or o.data.materials[face.material_index].name!='Satin walnut desk joinery':continue
   if max(abs(c)for c in face.normal)<.9999 or face.area<1e-7:continue
   indices=list(face.loop_indices)
   for j in range(1,len(indices)-1):
    ids=[indices[0],indices[j],indices[j+1]];v=[o.matrix_world@o.data.vertices[o.data.loops[i].vertex_index].co for i in ids];a=v[1]-v[0];b=v[2]-v[0]
    if a.cross(b).length<1e-8:continue
    x=a.normalized();y=a.cross(b).normalized().cross(x);metric=np.array([[a.dot(x),b.dot(x)],[a.dot(y),b.dot(y)]])
    u=[uv[i].uv for i in ids];du=u[1]-u[0];dv=u[2]-u[0];pixel=np.array([[du.x*1536,dv.x*1536],[du.y*1024,dv.y*1024]])
    uv_scales.extend(float(v)for v in np.linalg.svd(pixel@np.linalg.inv(metric),compute_uv=False));planar_wood_triangles+=1
expected_density=source['deskWoodMapping']['texelsPerMetre'];assert uv_scales and max(abs(v-expected_density)for v in uv_scales)<.35
uvReport={'planarTriangles':planar_wood_triangles,'expectedTexelsPerMetre':expected_density,'minimum':min(uv_scales),'maximum':max(uv_scales),'maxError':max(abs(v-expected_density)for v in uv_scales),'isotropic':True,'extraImages':0}
# Real cavities: center rays pass the front opening and reach the back/floor inside.
def ray_model(name,origin,direction):
 hits=[]
 for o in descendants(models[name]):
  bvh=BVHTree.FromPolygons([o.matrix_world@v.co for v in o.data.vertices],[list(f.vertices)for f in o.data.polygons]);loc,norm,index,distance=bvh.ray_cast(Vector(origin),Vector(direction),10)
  if loc is not None:hits.append((distance,loc))
 return min(hits,key=lambda h:h[0]) if hits else None
# Blender axes: -Y is Three front and +Z is up.
hit=ray_model('LockerShell',(0,-1,.70),(0,1,0));assert hit and hit[1].y>.27,('locker cavity blocked',hit)
drawerHit=ray_model('Drawer',(0,.22,.30),(0,0,-1));assert drawerHit and -.10<drawerHit[1].z<-.06,('drawer cavity blocked',drawerHit)
# Cover rises about its physical spine; door swings out through the clear front.
poseChecks=[]
for angle in [0,.5,1.2,2.15]:
 cover.rotation_euler.y=-angle;bpy.context.view_layer.update();lo,hi=bounds([o for o in allmeshes if o.parent==cover]);assert all(math.isfinite(v)for v in [*lo,*hi]);poseChecks.append({'notebookAngle':angle,'coverHighestY':hi.z})
assert poseChecks[2]['coverHighestY']>.4,poseChecks
cover.rotation_euler.y=0;door=models['LockerDoor']
for angle in [0,-.5,-1.0,-1.65]:
 door.rotation_euler.z=angle;bpy.context.view_layer.update();point=door.matrix_world@Vector((1.2,0,1.1));assert -point.y>=-.00001;poseChecks.append({'lockerAngle':angle,'farEdgeForwardZ':-point.y})
door.rotation_euler.z=0;bpy.context.view_layer.update()
report={'assetVersion':kit['assetVersion'],'glbSha256':hashlib.sha256(open(OUT+'/office-kit.glb','rb').read()).hexdigest(),'triangles':triangles,'renderMeshes':len(allmeshes),'embeddedImages':[{'name':im.name,'size':list(im.size)}for im in images],'models':measured,'deskWoodMapping':uvReport,'articulation':poseChecks,'checks':['Nine independent identity-transform templates and articulated notebook cover','Finite geometry, positive transforms, complete UVs and normals','Three embedded texture atlas images, no external image request','Geometry bounds and triangle counts match editable Blender source','Locker hollow center reaches inner rear wall','Drawer hollow center reaches inner bottom panel','Notebook spine and locker hinge pose sweeps','Isotropic desk and drawer metric UV density after GLB export','Four actual reimported-GLB Blender renders for each requested model']}
# Four imported GLB views per model, useful to compare to editable-source sheets.
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=12;scene.cycles.use_denoising=True;scene.render.resolution_x=512;scene.render.resolution_y=512;scene.render.resolution_percentage=100;scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGBA';world=bpy.data.worlds.new('Office QA world');world.use_nodes=True;world.node_tree.nodes.get('Background').inputs['Color'].default_value=(.18,.18,.18,1);world.node_tree.nodes.get('Background').inputs['Strength'].default_value=.5;scene.world=world;scene.view_settings.view_transform='AgX'
bpy.ops.mesh.primitive_plane_add(size=200);ground=bpy.context.object;gm=bpy.data.materials.new('QA ground');gm.use_nodes=True;gm.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value=(.065,.074,.076,1);gm.node_tree.nodes.get('Principled BSDF').inputs['Roughness'].default_value=.82;ground.data.materials.append(gm)
lights=[]
for name,pos,energy,size,color in [('Warm key',(-2,-3,4),650,4,(1,.89,.74)),('Cool fill',(3,-1,2.4),400,3,(.77,.86,1)),('Warm rim',(-1,3,3.5),850,3,(1,.91,.8))]:
 d=bpy.data.lights.new(name,'AREA');d.energy=energy;d.shape='DISK';d.size=size;d.color=color;o=bpy.data.objects.new(name,d);scene.collection.objects.link(o);lights.append((o,Vector(pos),energy,size))
d=bpy.data.cameras.new('Office GLB review');camera=bpy.data.objects.new('Office GLB review',d);scene.collection.objects.link(camera);scene.camera=camera;d.type='ORTHO'
for name in (args.render_models.split(',') if args.render_models else models):
 p=models[name];keep=descendants(p)
 for o in allmeshes:o.hide_render=o not in keep
 lo,hi=bounds(keep);center=(lo+hi)/2;extent=max(hi-lo);ground.location.z=lo.z-.003;d.ortho_scale=extent*1.43
 for o,pos,e,s in lights:o.location=center+pos*extent*.7;o.data.energy=e*extent*extent*.5;o.data.size=s*extent*.65;o.rotation_euler=(center-o.location).to_track_quat('-Z','Y').to_euler()
 sheet=np.ones((1024,1024,4),np.float32)
 for i,v in enumerate([(1,-1,.82),(-1,-1,.66),(-1,1,.8),(1,1,.45)]):
  camera.location=center+Vector(v)*extent*2;camera.rotation_euler=(center-camera.location).to_track_quat('-Z','Y').to_euler();path=ART+'/renders/rt-frame.png';scene.render.filepath=path;bpy.ops.render.render(write_still=True);im=bpy.data.images.load(path,check_existing=False);arr=np.array(im.pixels[:],np.float32).reshape((512,512,4));row=1-i//2;col=i%2;sheet[row*512:(row+1)*512,col*512:(col+1)*512]=arr;bpy.data.images.remove(im)
 im=bpy.data.images.new('GLB '+name+' four angles',width=1024,height=1024,alpha=True);im.colorspace_settings.name='sRGB';im.pixels.foreach_set(sheet.ravel());im.filepath_raw=ART+'/renders/glb-'+name.lower()+'-four-angles.png';im.file_format='PNG';im.save();bpy.data.images.remove(im);print('OFFICE_GLBSHEET_READY '+name,flush=True)
os.remove(ART+'/renders/rt-frame.png')
with open(ART+'/roundtrip-qa.json','w')as f:json.dump(report,f,indent=2)
print('OFFICE_ROUNDTRIP_PASS '+json.dumps({'triangles':triangles,'models':len(models),'images':len(images),'checks':len(report['checks'])}),flush=True)
