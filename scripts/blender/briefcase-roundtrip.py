"""Reopen the exported GLB in Blender and validate/render its actual runtime asset.
This intentionally deletes editable source geometry before importing the GLB.
"""
import bpy, os, json, math, numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree
ROOT=os.path.abspath(os.path.join(os.path.dirname(__file__),'../..')); ART=ROOT+'/art/briefcase';OUT=ROOT+'/public/models/briefcase'
bpy.ops.wm.open_mainfile(filepath=ART+'/restore-retro-briefcase.blend')
col=bpy.data.collections.get('Briefcase editable components')
for ob in list(col.objects):bpy.data.objects.remove(ob,do_unlink=True)
bpy.data.collections.remove(col)
before=set(bpy.data.objects);bpy.ops.import_scene.gltf(filepath=OUT+'/briefcase.glb');new=set(bpy.data.objects)-before
meshes=[o for o in new if o.type=='MESH'];root=bpy.data.objects['Briefcase'];lid=bpy.data.objects['LidPivot']
assert root.get('assetVersion')=='1.0.4',dict(root.items())
assert len(meshes)==20,len(meshes)
triangles=sum(sum(len(p.vertices)-2 for p in o.data.polygons)for o in meshes);assert triangles<=35000,triangles;assert triangles==json.load(open(ART+'/asset-report.json'))['triangles'],triangles
images={node.image for o in meshes for m in o.data.materials for node in m.node_tree.nodes if node.type=='TEX_IMAGE' and node.image}
assert len(images)==4,len(images)
assert all(im.packed_file or len(im.packed_files) for im in images),'GLB imported an external image'
assert all(math.isfinite(v)for o in meshes for vv in o.data.vertices for v in vv.co),'Non finite mesh coordinate'
assert all(o.data.uv_layers.active for o in meshes),'Missing UVs'
assert all(o.matrix_world.determinant()>0 for o in new),'Mirrored transform'
# Source and export are compared using the same five physical hinge poses.
def bvh(ob):return BVHTree.FromPolygons([ob.matrix_world@v.co for v in ob.data.vertices],[list(f.vertices)for f in ob.data.polygons])
body_bvh=bvh(bpy.data.objects['BodyStatic']);sweep=[]
for a in [0,-.35,-.8,-1.3,-1.75]:
    lid.rotation_euler.x=a;bpy.context.view_layer.update();overlaps=len(body_bvh.overlap(bvh(bpy.data.objects['LidStatic'])))
    sweep.append({'lidAngle':a,'paintedShellTriangleIntersections':overlaps});assert overlaps==0,sweep
lid.rotation_euler.x=0;bpy.context.view_layer.update()
report={'assetVersion':root['assetVersion'],'importedGLB':os.path.basename(OUT+'/briefcase.glb'),'triangles':triangles,'renderMeshes':len(meshes),'embeddedImages':[{'name':im.name,'width':im.size[0],'height':im.size[1]}for im in images],'hingeSweep':sweep,'checks':['GLB self contained with four embedded textures','Twenty render meshes, matching exported geometry, below 35,000 triangles','Positive transforms, finite coordinates, complete UV layers','Five imported hinge poses without painted shell intersections','Four actual imported GLB Blender studio renders']}
with open(ART+'/roundtrip-qa.json','w')as f:json.dump(report,f,indent=2)
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=24;scene.cycles.use_denoising=True;scene.render.resolution_x=640;scene.render.resolution_y=640;scene.render.resolution_percentage=100;scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGBA';camera=scene.camera;camera.data.ortho_scale=1.43
result=np.ones((1280,1280,4),np.float32)
for i,pos in enumerate([(1.2,-1.5,1.15),(-1.2,-1.5,.85),(-1.2,1.5,1.1),(1.2,1.5,.65)]):
    camera.location=pos;camera.rotation_euler=(Vector((0,0,.04))-camera.location).to_track_quat('-Z','Y').to_euler();path=ART+'/renders/glb-roundtrip-'+str(i+1)+'.png';scene.render.filepath=path;bpy.ops.render.render(write_still=True)
    im=bpy.data.images.load(path,check_existing=False);arr=np.array(im.pixels[:],np.float32).reshape((640,640,4));row=1-i//2;col=i%2;result[row*640:(row+1)*640,col*640:(col+1)*640]=arr;bpy.data.images.remove(im)
im=bpy.data.images.new('GLB round trip four angles',width=1280,height=1280,alpha=True);im.colorspace_settings.name='sRGB';im.pixels.foreach_set(result.ravel());im.filepath_raw=ART+'/renders/glb-roundtrip-four-angles.png';im.file_format='PNG';im.save()
print('ROUNDTRIP_PASS '+json.dumps(report),flush=True)
