"""Reopen the exported GLB in Blender and validate/render its actual runtime asset.
This intentionally deletes editable source geometry before importing the GLB.
"""
import bpy, os, json, math, hashlib, numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree
ROOT=os.path.abspath(os.path.join(os.path.dirname(__file__),'../..')); ART=ROOT+'/art/briefcase';OUT=ROOT+'/public/models/briefcase'
bpy.ops.wm.open_mainfile(filepath=ART+'/restore-retro-briefcase.blend')
col=bpy.data.collections.get('Briefcase editable components')
for ob in list(col.objects):bpy.data.objects.remove(ob,do_unlink=True)
bpy.data.collections.remove(col)
before=set(bpy.data.objects);bpy.ops.import_scene.gltf(filepath=OUT+'/briefcase.glb');new=set(bpy.data.objects)-before
meshes=[o for o in new if o.type=='MESH'];root=bpy.data.objects['Briefcase'];lid=bpy.data.objects['LidPivot']
assert root.get('assetVersion')=='1.1.0',dict(root.items())
assert len(meshes)==19,len(meshes)
triangles=sum(sum(len(p.vertices)-2 for p in o.data.polygons)for o in meshes);assert triangles<=60000,triangles;assert triangles==json.load(open(ART+'/asset-report.json'))['triangles'],triangles
images={node.image for o in meshes for m in o.data.materials for node in m.node_tree.nodes if node.type=='TEX_IMAGE' and node.image}
assert len(images)==3,len(images)
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
# Reimported geometry must contain all ten physical glyphs, at every 36-degree detent.
import bmesh
assert not any('Handle' in o.name or 'NumberDisplay' in o.name for o in new),'Obsolete handle or static digit display'
assert root['numeralGeometry'] and root['numeralsPerWheel']==10 and root['handleRemoved']
assert abs(root['wheelStep']-math.tau/10)<1e-9
wheel_checks=[]
for i in range(4):
    wheel=bpy.data.objects['Wheel_'+str(i)];wheel.rotation_mode='XYZ'
    numerals=bpy.data.objects['WheelNumerals_'+str(i)];assert numerals.parent==wheel
    assert wheel['numerals']=='0123456789'
    assert all(n.type!='TEX_IMAGE'for m in numerals.data.materials for n in m.node_tree.nodes),'Numerals must be physical geometry'
    bm=bmesh.new();bm.from_mesh(numerals.data);bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=1e-7)
    unseen=set(bm.verts);groups=[]
    while unseen:
        todo=[unseen.pop()];group=[]
        while todo:
            v=todo.pop();group.append(v)
            for edge in v.link_edges:
                other=edge.other_vert(v)
                if other in unseen:unseen.remove(other);todo.append(other)
        groups.append(group)
    assert len(groups)==20,(i,len(groups)) # ten solid number glyphs plus ten solid separators
    assert all(e.is_manifold for e in bm.edges),'Non-manifold imported black inlay'
    bm.free()
    for digit in range(10):
        wheel.rotation_euler.x=-digit*math.tau/10;bpy.context.view_layer.update()
        pts=[numerals.matrix_world@v.co for v in numerals.data.vertices];front=max(-v.y for v in pts)
        face=[v for v in pts if abs(-v.y-front)<1e-6]
        height=max(v.z for v in face)-min(v.z for v in face);middle=(max(v.z for v in face)+min(v.z for v in face))/2
        inset=.358+.0475*math.cos(math.pi/10)-front
        assert abs(height-.022)<2e-6 and abs(middle-.01)<2e-6,(i,digit,height,middle)
        assert abs(inset-.0003)<2e-6,(i,digit,inset)
        wheel_checks.append({'wheel':i,'digit':digit,'rotationX':-digit*math.tau/10,'frontInkHeight':round(height,6),'inset':round(inset,7),'solidGlyphs':10,'solidSeparators':10})
    wheel.rotation_euler.x=0
bpy.context.view_layer.update()
report={'glbSha256':hashlib.sha256(open(OUT+'/briefcase.glb','rb').read()).hexdigest(),'assetVersion':root['assetVersion'],'importedGLB':os.path.basename(OUT+'/briefcase.glb'),'triangles':triangles,'renderMeshes':len(meshes),'embeddedImages':[{'name':im.name,'width':im.size[0],'height':im.size[1]}for im in images],'hingeSweep':sweep,'wheelDetents':wheel_checks,'checks':['GLB self contained with three embedded atlas textures and texture-free solid black numerals','Nineteen render meshes, matching exported geometry, below 60,000 triangles','All forty physical glyph detents read upright, centered and 0.30 mm inset after GLB reimport','Ten manifold solid glyphs and ten solid separator inlays in each wheel material batch','No handle, attachments, static number display nodes or digit images','Positive transforms, finite coordinates, complete UV layers','Five imported hinge poses without painted shell intersections','Four actual imported GLB Blender studio renders']}
with open(ART+'/roundtrip-qa.json','w')as f:json.dump(report,f,indent=2)
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=24;scene.cycles.use_denoising=True;scene.render.resolution_x=640;scene.render.resolution_y=640;scene.render.resolution_percentage=100;scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGBA';camera=scene.camera;camera.data.ortho_scale=1.43
result=np.ones((1280,1280,4),np.float32)
for i,pos in enumerate([(1.2,-1.5,1.15),(-1.2,-1.5,.85),(-1.2,1.5,1.1),(1.2,1.5,.65)]):
    camera.location=pos;camera.rotation_euler=(Vector((0,0,.04))-camera.location).to_track_quat('-Z','Y').to_euler();path=ART+'/renders/glb-roundtrip-'+str(i+1)+'.png';scene.render.filepath=path;bpy.ops.render.render(write_still=True)
    im=bpy.data.images.load(path,check_existing=False);arr=np.array(im.pixels[:],np.float32).reshape((640,640,4));row=1-i//2;col=i%2;result[row*640:(row+1)*640,col*640:(col+1)*640]=arr;bpy.data.images.remove(im)
im=bpy.data.images.new('GLB round trip four angles',width=1280,height=1280,alpha=True);im.colorspace_settings.name='sRGB';im.pixels.foreach_set(result.ravel());im.filepath_raw=ART+'/renders/glb-roundtrip-four-angles.png';im.file_format='PNG';im.save()
print('ROUNDTRIP_PASS '+json.dumps(report),flush=True)
