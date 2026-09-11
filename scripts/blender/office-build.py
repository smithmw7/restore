"""Restore office kit. Blender-authored meters, Three axes x right/y up/z front.
Run Blender -b --python scripts/blender/office-build.py -- [--final] [--skip-renders].
Exports independent templates; staged positions never enter the GLB.
"""
import bpy, math, os, sys, json, argparse, hashlib
import numpy as np
from mathutils import Vector
ROOT=os.path.abspath(os.path.join(os.path.dirname(__file__),'../..')); ART=ROOT+'/art/office'; OUT=ROOT+'/public/models/office'
for p in [ART,ART+'/textures',ART+'/renders',OUT]:os.makedirs(p,exist_ok=True)
parser=argparse.ArgumentParser();parser.add_argument('--final',action='store_true');parser.add_argument('--skip-renders',action='store_true');args=parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
COL=bpy.data.collections.new('Office editable components');bpy.context.scene.collection.children.link(COL)
def C(p):return (p[0],-p[2],p[1])
def image_write(name,arr,path,space='Non-Color'):
 h,w=arr.shape[:2];im=bpy.data.images.new(name,width=w,height=h,alpha=True);im.colorspace_settings.name=space;im.pixels.foreach_set(arr.astype(np.float32).ravel());im.filepath_raw=path;im.file_format='PNG';im.save();return im
# Native Blender-generated placeholder surfaces. All six materials use the same UV atlas.
W,H=1536,1024; S=512; rng=np.random.default_rng(1942); base=np.ones((H,W,4),np.float32); orm=np.ones_like(base); height=np.zeros((H,W),np.float32)
colors=[(.245,.112,.052),(.205,.070,.045),(.225,.260,.185),(.55,.405,.225),(.72,.66,.51),(.14,.145,.137)]
roughness=[.48,.62,.61,.37,.88,.53];metalness=[0,0,.22,.91,0,.86]
for q in range(6):
 yy,xx=np.mgrid[0:S,0:S];noise=rng.normal(0,1,(S,S));fine=noise*.007;grain=np.sin(yy*.135+np.sin(xx*.018)*1.8)+.4*np.sin(yy*.49+np.sin(xx*.013)*3);cloud=np.sin(xx*.027)*np.cos(yy*.031)
 if q==0: tone=grain*.018+fine+cloud*.009;relief=grain*.025+noise*.008
 elif q==1:tone=cloud*.013+fine;relief=np.sin(xx*1.22)*np.sin(yy*1.07)*.11+noise*.05
 elif q==2:tone=cloud*.018+fine*.45;relief=noise*.04+cloud*.012
 elif q==3:tone=np.sin(yy*2.32)*.009+cloud*.02+fine*.45;relief=np.sin(yy*2.32)*.045+noise*.005
 elif q==4:tone=cloud*.018+fine*.55;relief=noise*.065
 else:tone=cloud*.01+fine*.5;relief=np.sin(yy*1.6)*.04+noise*.012
 sl=(slice((q//3)*S,(q//3+1)*S),slice((q%3)*S,(q%3+1)*S));base[sl+(slice(0,3),)]=np.clip(np.array(colors[q])+tone[:,:,None],.015,.94);orm[sl+(0,)]=1;orm[sl+(1,)]=np.clip(roughness[q]+cloud*.035+fine,.05,.98);orm[sl+(2,)]=metalness[q];height[sl]=relief
normal=np.ones_like(base);gy,gx=np.gradient(height);normal[:,:,0]=.5-gx*.3;normal[:,:,1]=.5-gy*.3;normal[:,:,2]=1
placeholder=ART+'/textures/office-basecolor-placeholder.png';final=ART+'/textures/office-basecolor-final.png'
if not os.path.exists(placeholder):image_write('Office placeholder atlas',base,placeholder,'sRGB')
for name,arr in [('normal',normal),('orm',orm)]:
 path=ART+'/textures/office-'+name+'.png'
 if not os.path.exists(path):image_write('Office '+name,arr,path)
print('OFFICE_ATLAS_READY '+placeholder,flush=True)
if args.final and not os.path.exists(final):raise FileNotFoundError(final)
baseim=bpy.data.images.load(final if args.final else placeholder);baseim.colorspace_settings.name='sRGB'
normim=bpy.data.images.load(ART+'/textures/office-normal.png');normim.colorspace_settings.name='Non-Color'
ormim=bpy.data.images.load(ART+'/textures/office-orm.png');ormim.colorspace_settings.name='Non-Color'
mats=[]
for q,name in enumerate(['Worn walnut','Oxblood leather','Aged olive enamel','Antique brass','Ivory paper','Blackened steel']):
 m=bpy.data.materials.new(name);m.use_nodes=True;n=m.node_tree.nodes;l=m.node_tree.links;p=n.get('Principled BSDF');t=n.new('ShaderNodeTexImage');t.image=baseim;l.new(t.outputs['Color'],p.inputs['Base Color']);o=n.new('ShaderNodeTexImage');o.image=ormim;s=n.new('ShaderNodeSeparateColor');l.new(o.outputs['Color'],s.inputs[0]);l.new(s.outputs['Green'],p.inputs['Roughness']);l.new(s.outputs['Blue'],p.inputs['Metallic']);t=n.new('ShaderNodeTexImage');t.image=normim;nm=n.new('ShaderNodeNormalMap');nm.inputs['Strength'].default_value=.45;l.new(t.outputs['Color'],nm.inputs['Color']);l.new(nm.outputs[0],p.inputs['Normal']);m.diffuse_color=(*colors[q],1);mats.append(m)
kit=bpy.data.objects.new('OfficeKit',None);COL.objects.link(kit);kit['assetVersion']='1.0.0';kit['kitId']='restore-retro-office';kit['coordinateSystem']='meters; x right, y up, z front';kit['atlasMaterials']=6
models={};parts=[]
def empty(name,parent=kit,pos=(0,0,0)):
 o=bpy.data.objects.new(name,None);COL.objects.link(o);o.parent=parent;o.location=C(pos);return o
for name in ['Desk','Drawer','Notebook','LockerShell','LockerDoor','Chair','Pen','Pencil','Logbook']:models[name]=empty(name)
cover=empty('NotebookCover',models['Notebook'],(-.215,.055,0))
def uv(o,q):
 if not o.data.uv_layers:o.data.uv_layers.new(name='UVMap')
 vs=o.data.vertices;lo=[min(v.co[i]for v in vs)for i in range(3)];hi=[max(v.co[i]for v in vs)for i in range(3)];span=[hi[i]-lo[i]for i in range(3)]
 # Use an interior tile patch, never the atlas boundary; grain follows the longer edge.
 seed=int(hashlib.sha1(o.name.encode()).hexdigest()[:8],16);pad=.045;offset=(seed%97)/97*.07
 for f in o.data.polygons:
  axis=max(range(3),key=lambda i:abs(f.normal[i]));axes=sorted([i for i in range(3)if i!=axis],key=lambda i:span[i],reverse=True);a,b=axes
  for li in f.loop_indices:
   v=vs[o.data.loops[li].vertex_index].co;u=(v[a]-lo[a])/max(span[a],1e-8);w=(v[b]-lo[b])/max(span[b],1e-8)
   # Narrow components sample a proportional strip instead of stretching a whole tile.
   aspect=min(1,max(.025,span[b]/max(span[a],.0001)));uu=pad+u*(1-2*pad);vv=.42+offset+(w-.5)*(.8*aspect)
   o.data.uv_layers.active.data[li].uv=((q%3+uu)/3,(q//3+vv)/2)
def finish(o,name,q,parent,bevel):
 o.name=name
 for c in list(o.users_collection):c.objects.unlink(o)
 COL.objects.link(o);o.parent=parent;o.data.materials.append(mats[q]);o['materialTile']=q;parts.append(o)
 bpy.context.view_layer.objects.active=o
 if bevel:
  mod=o.modifiers.new('Crafted softened edges','BEVEL');mod.width=bevel;mod.segments=3 if bevel>.004 else 2;mod.affect='EDGES';bpy.ops.object.modifier_apply(modifier=mod.name)
 for f in o.data.polygons:f.use_smooth=True
 mod=o.modifiers.new('Planar weighted normals','WEIGHTED_NORMAL');mod.keep_sharp=True;mod.weight=40
 try:bpy.ops.object.modifier_apply(modifier=mod.name)
 except:pass
 o.data.update();uv(o,q);o.select_set(False);return o
def box(name,size,pos,q,parent,bevel=.003):
 bpy.ops.mesh.primitive_cube_add(size=1,location=C(pos));o=bpy.context.object;o.dimensions=(size[0],size[2],size[1]);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);return finish(o,name,q,parent,bevel)
def cyl(name,r,depth,pos,q,parent,axis='Y',verts=16,bevel=.0005):
 bpy.ops.mesh.primitive_cylinder_add(vertices=verts,radius=r,depth=depth,location=C(pos));o=bpy.context.object
 if axis=='X':o.rotation_euler[1]=math.pi/2
 elif axis=='Z':o.rotation_euler[0]=math.pi/2
 bpy.ops.object.transform_apply(location=False,rotation=True,scale=True);return finish(o,name,q,parent,bevel)
def cone(name,r1,r2,depth,pos,q,parent,axis='X',verts=16):
 bpy.ops.mesh.primitive_cone_add(vertices=verts,radius1=r1,radius2=r2,depth=depth,location=C(pos));o=bpy.context.object
 if axis=='X':o.rotation_euler[1]=math.pi/2
 elif axis=='Z':o.rotation_euler[0]=math.pi/2
 bpy.ops.object.transform_apply(location=False,rotation=True,scale=True);return finish(o,name,q,parent,.0002)
def rod(name,a,b,r,q,parent,verts=12):
 aa=Vector(C(a));bb=Vector(C(b));bpy.ops.mesh.primitive_cylinder_add(vertices=verts,radius=r,depth=(bb-aa).length,location=(aa+bb)/2);o=bpy.context.object;o.rotation_euler=(bb-aa).to_track_quat('Z','Y').to_euler();bpy.ops.object.transform_apply(location=False,rotation=True,scale=True);return finish(o,name,q,parent,.0006)
def screw(name,pos,parent,axis='Z',r=.004,q=3):
 cyl(name+' slotted head',r,.002,pos,q,parent,axis,12,.0003);p=list(pos);p[2]+=.0012 if axis=='Z' else 0;p[1]+=.0012 if axis=='Y' else 0
 box(name+' inset slot',(r*1.35,.00065,.0006)if axis=='Z' else(r*1.35,.0006,.00065),p,5,parent,.0001)
def torus(name,major,minor,pos,q,parent,axis='Y'):
 bpy.ops.mesh.primitive_torus_add(major_segments=24,minor_segments=8,location=C(pos),major_radius=major,minor_radius=minor);o=bpy.context.object
 if axis=='X':o.rotation_euler[1]=math.pi/2
 elif axis=='Z':o.rotation_euler[0]=math.pi/2
 bpy.ops.object.transform_apply(location=False,rotation=True,scale=True);return finish(o,name,q,parent,0)
def mesh(name,vertices,faces,q,parent,bevel=0):
 data=bpy.data.meshes.new(name);data.from_pydata([C(v)for v in vertices],[],faces);data.update();o=bpy.data.objects.new(name,data);COL.objects.link(o);bpy.context.view_layer.objects.active=o;o.select_set(True);bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.mesh.normals_make_consistent(inside=False);bpy.ops.object.mode_set(mode='OBJECT');return finish(o,name,q,parent,bevel)
# DESK: solid walnut top with edging, real open knee space, drawer runners and rail joinery.
p=models['Desk'];p['origin']='floor center';p['fixed']=True
box('Walnut desk slab',(2.60,.085,.95),(0,.9175,0),0,p,.013)
box('Ogee lower edge shadow',(2.555,.022,.91),(0,.869,0),5,p,.006)
box('Walnut desk underframe',(2.535,.034,.9),(0,.842,0),0,p,.006)
for x in [-1.145,1.145]:
 for z in [-.335,.335]:
  box('Tapered hardwood leg',(.12,.812,.12),(x,.406,z),0,p,.007)
  box('Brass leg ferrule',(.124,.044,.124),(x,.028,z),3,p,.005)
  box('Leather floor pad',(.116,.008,.116),(x,.004,z),1,p,.003)
 for z in [-.325,.325]:screw('Desk joinery peg',(x,.816,z),p,'Y',.007,0)
 box('Side apron',(.074,.236,.67),(x,.714,0),0,p,.005)
 box('Recessed side apron panel',(.078,.153,.49),(x,.712,0),0,p,.008)
box('Rear walnut apron',(2.32,.24,.066),(0,.712,-.355),0,p,.005)
for x in [-.59,.59]:
 box('Drawer guide carrier',(.055,.27,.67),(x,.71,0),0,p,.004)
 box('Waxed drawer guide',(.02,.027,.53),(x,.628,.028),3,p,.002)
# Thin desk blotter with folded leather corner pieces.
box('Leather desk blotter',(.62,.009,.35),(.42,.965,-.14),1,p,.006)
for x in [.13,.71]:
 for z in [-.293,.013]:box('Blotter leather corner tab',(.055,.003,.026),(x,.971,z),1,p,.003)
# DRAWER: open wooden tray, dovetailed sides and cast brass cup pull, face center local origin.
p=models['Drawer'];p['origin']='front face center; cavity extends negative z'
box('Drawer front', (1.10,.23,.048),(0,0,0),0,p,.006)
box('Inset raised drawer field',(.98,.153,.009),(0,0,.025),0,p,.005)
box('Drawer plywood bottom',(1.035,.022,.475),(0,-.092,-.246),0,p,.002)
for x in [-.513,.513]:
 box('Dovetail drawer side',(.029,.187,.463),(x,.005,-.249),0,p,.002)
 for y in [-.064,-.015,.036,.083]:box('Endgrain dovetail',(.033,.02,.042),(x,y,-.034),0,p,.001)
box('Drawer back',(1.038,.187,.028),(0,.005,-.476),0,p,.002)
box('Cup pull backplate',(.254,.075,.008),(0,.008,.034),3,p,.01)
# Cast half-round pull shell, with a dark recess behind the finger opening.
box('Cup handle finger shadow',(.175,.033,.003),(0,-.008,.040),5,p,.008)
for x in [-.097,.097]:rod('Cup handle return',(x,-.009,.044),(x,.014,.068),.009,3,p)
rod('Cup handle brow',(-.097,.014,.068),(.097,.014,.068),.009,3,p,20)
for x in [-.109,.109]:screw('Drawer pull mounting screw',(x,.008,.040),p,r=.006)
# NOTEBOOK: layered signatures, bookcloth spine, articulated cover and bookmark ribbon.
p=models['Notebook'];p['origin']='bottom center';cover['hingeAxis']='local z; positive angle opens';cover['closedAngle']=0
box('Notebook back cover',(.43,.008,.31),(0,.004,0),1,p,.004)
box('Notebook text block',(.407,.042,.288),(.006,.029,0),4,p,.002)
for j in range(10):
 y=.011+j*.00385;box('Notebook sewn signature fore edge',(.400,.0006,.289),(.006,y,0),4,p,.00015)
box('Notebook rolled spine',(.015,.052,.306),(-.208,.028,0),1,p,.005)
box('Notebook hinged cover',(.43,.009,.31),(.215,0,0),1,cover,.004)
box('Notebook inset cover panel',(.348,.0016,.236),(.22,.0053,0),1,cover,.006)
for x in [.048,.392]:box('Notebook blind tooled border',(.0015,.0015,.252),(x,.006,0),3,cover,.0002)
for z in [-.126,.126]:box('Notebook blind tooled border',(.344,.0015,.0015),(.22,.006,z),3,cover,.0002)
box('Notebook ribbon marker',(.012,.002,.19),(.046,.052,.112),2,p,.0005)
for z in [-.124,.124]:rod('Notebook binding headband',(-.198,.049,z),(-.174,.049,z),.002,3,p)
# LOCKER SHELL: folded sheet steel, return flanges and actual hollow compartments.
p=models['LockerShell'];p['origin']='floor center';p['hollow']=True
box('Locker bottom folded pan',(1.30,.055,.65),(0,.0275,0),2,p,.005)
box('Locker top folded cap',(1.30,.055,.65),(0,2.1725,0),2,p,.005)
for x in [-.632,.632]:
 box('Locker wall',(.036,2.10,.65),(x,1.10,0),2,p,.004)
 box('Locker front return flange',(.045,2.102,.025),(x,1.1,.325),2,p,.003)
box('Locker rear wall',(1.234,2.10,.022),(0,1.10,-.314),2,p,.003)
for y in [1.12,1.86]:
 box('Locker shelf',(1.228,.026,.602),(0,y,0),2,p,.003)
 box('Shelf folded front lip',(1.228,.044,.015),(0,y-.010,.303),2,p,.002)
 for x in [-.605,.605]:box('Shelf steel supporting angle',(.025,.12,.12),(x,y-.057,-.18),5,p,.002)
for x in [-.622,.622]:
 for y in [.22,.64,1.06,1.50,1.96]:screw('Locker frame rivet',(x,y,.342),p,r=.0045,q=5)
for x in [-.50,.50]:box('Locker inset floor foot',(.14,.026,.53),(x,.013,0),5,p,.003)
rod('Locker interior coat rail',(-.52,1.72,-.11),(.52,1.72,-.11),.012,5,p)
# Locker door panel has real cut-through louvers, folded backs, visible hinges and latch.
p=models['LockerDoor'];p['origin']='left bottom hinge; positive x extends into opening';p['hingeAxis']='local y';p['openAngle']=-1.65
panel=box('Stamped locker door skin',(1.264,2.108,.025),(.65,1.10,0),2,p,.005)
# Cut 12 horizontal slots in one Boolean, keeping a convincing thin folded sheet.
cutters=[]
for cy in [.35,1.87]:
 for j in range(6):
  y=cy+(j-2.5)*.035;bpy.ops.mesh.primitive_cube_add(size=1,location=C((.65,y,0)));cut=bpy.context.object;cut.dimensions=(.36,.12,.012);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);cutters.append(cut)
  lip=box('Stamped louver awning',(.374,.006,.022),(.65,y+.006,.018),2,p,.002)
  lip.rotation_euler.x=math.radians(-12)
for o in bpy.context.selected_objects:o.select_set(False)
for o in cutters:o.select_set(True)
bpy.context.view_layer.objects.active=cutters[0];bpy.ops.object.join();cutter=bpy.context.object;bpy.context.view_layer.objects.active=panel;mod=panel.modifiers.new('Actual vent openings','BOOLEAN');mod.operation='DIFFERENCE';mod.solver='EXACT';mod.object=cutter;bpy.ops.object.modifier_apply(modifier=mod.name);bpy.data.objects.remove(cutter,do_unlink=True);uv(panel,2)
for x in [.032,1.268]:box('Door folded vertical hem',(.028,2.104,.039),(x,1.1,-.026),2,p,.003)
for y in [.058,2.142]:box('Door folded horizontal hem',(1.226,.024,.035),(.65,y,-.026),2,p,.003)
for y in [.22,1.10,1.98]:
 cyl('Interleaved hinge barrel',.013,.10,(.007,y,0),5,p,'Y',16)
 box('Hinge leaf',(.073,.098,.008),(.044,y,-.013),5,p,.002)
 for yy in [y-.032,y+.032]:screw('Hinge leaf rivet',(.050,yy,-.007),p,r=.004,q=5)
box('Locker latch escutcheon',(.075,.227,.011),(1.145,1.065,.023),5,p,.01)
box('Locker lever upright',(.028,.126,.039),(1.145,1.10,.051),3,p,.010)
cyl('Latch key cylinder',.014,.014,(1.145,.995,.041),3,p,'Z',20)
box('Keyhole slit',(.0035,.014,.001),(1.145,.995,.050),5,p,.001)
# Empty aged label with metal frame, no player-facing wording.
box('Locker label plate',(.187,.069,.008),(.65,2.065,.024),5,p,.004)
box('Locker paper label',(.157,.039,.0015),(.65,2.066,.029),4,p,.001)
for x in [.56,.74]:screw('Label frame screw',(x,2.064,.030),p,r=.003,q=3)
# CHAIR: slightly raked walnut frame with upholstered cushions, piping and upholstery tacks.
p=models['Chair'];p['origin']='bounds center at seat plus .10m; floor local y=-.59'
box('Seat hardwood frame',(.52,.044,.50),(0,-.165,0),0,p,.015)
box('Leather seat cushion',(.53,.09,.49),(0,-.106,-.008),1,p,.036)
for z in [-.235,.235]:rod('Seat cushion piping',(-.235,-.09,z),(.235,-.09,z),.0035,1,p,12)
for x in [-.245,.245]:rod('Seat cushion piping',(x,-.09,-.21),(x,-.09,.21),.0035,1,p,12)
for x in [-.215,.215]:
 for z in [-.205,.205]:
  rod('Tapered chair leg',(x*1.04,-.580,z*1.04),(x,-.171,z),.021,0,p,12)
  cyl('Chair brass glide',.024,.018,(x*1.04,-.581,z*1.04),3,p,'Y',16)
  cyl('Chair felt pad',.021,.007,(x*1.04,-.5865,z*1.04),1,p,'Y',12)
 rod('Side stretcher',(x,-.390,-.202),(x,-.390,.202),.014,0,p)
 rod('Backrest stile',(x,-.15,.191),(x,.572,.264),.020,0,p)
rod('Front stretcher',(-.212,-.391,-.203),(.212,-.391,-.203),.014,0,p)
back=box('Walnut back frame',(.53,.568,.069),(0,.29,.233),0,p,.028);back.rotation_euler.x=math.radians(5.8)
back=box('Leather back cushion',(.465,.485,.077),(0,.30,.187),1,p,.034);back.rotation_euler.x=math.radians(5.8)
for x in [-.22,.22]:
 for j in range(9):cyl('Upholstery brass tack',.0032,.0025,(x,.095+j*.046,.139+j*.0046),3,p,'Z',10,.0002)
for x in [-.154,0,.154]:
 for y in [.18,.39]:cyl('Upholstered back button',.008,.003,(x,y,.139+(y-.095)*.1),1,p,'Z',16)
# PEN: 1950s fountain pen with threaded section, split gold nib, breather hole and removable-look cap.
p=models['Pen'];p['origin']='center, nib points positive x'
cyl('Resin pen barrel',.0070,.092,(-.029,0,0),5,p,'X',24)
cone('Barrel rounded end',.004,.0069,.012,(-.081,0,0),5,p,'X',24)
cyl('Pen cap seam collar',.0073,.004,(.019,0,0),3,p,'X',24)
cyl('Pen grip section',.0055,.029,(.0355,0,0),5,p,'X',20)
for x in [.023,.026,.029]:torus('Pen grip turning ring',.0057,.0004,(x,0,0),5,p,'X')
# Nib as domed tapered gold sheet, with visible central black slit.
vertices=[(.049,-.002,-.0045),(.049,.001,-.0045),(.049,.0028,0),(.049,.001,.0045),(.049,-.002,.0045),(.081,.0002,0),(.070,.0022,0)];faces=[(0,1,2,6,5),(2,3,4,5,6),(0,5,4,3,2,1)]
mesh('Gold fountain nib',vertices,faces,3,p,.0004)
box('Nib split tine line',(.020,.00035,.0003),(.069,.0021,0),5,p,.0001)
cyl('Nib breather hole',.0011,.0004,(.057,.0029,0),5,p,'Y',12,.0001)
rod('Spring pen pocket clip',(-.073,.008,0),(-.024,.008,0),.0014,3,p,12)
cyl('Pen clip mounting band',.0074,.003,(-.069,0,0),3,p,'X',24)
cyl('Pen cap end jewel',.005,.002,(-.087,0,0),3,p,'X',20)
# PENCIL: hexagonal lacquer barrel, real cedar sharpened cone, graphite and ferrule ribs.
p=models['Pencil'];p['origin']='center; sharpened point positive x'
cyl('Hexagonal cedar pencil',.0045,.142,(-.007,0,0),2,p,'X',6,.00015)
cone('Sharpened cedar pencil tip',.0045,.00075,.018,(.073,0,0),0,p,'X',6)
cone('Graphite point',.0008,.00008,.006,(.085,0,0),5,p,'X',12)
cyl('Pencil brass ferrule',.0046,.012,(-.084,0,0),3,p,'X',16)
for x in [-.089,-.086,-.082,-.079]:torus('Ferrule pressed groove',.0046,.0003,(x,0,0),5,p,'X')
# LOGBOOK: thick bound account ledger, layered signatures, raised spine bands and gilt trim.
p=models['Logbook'];p['origin']='bounds center'
box('Logbook page block',(.279,.039,.202),(.004,0,0),4,p,.002)
for y in [-.024,.024]:box('Logbook leather board',(.30,.007,.22),(0,y,0),1,p,.003)
box('Rounded ledger spine',(.018,.052,.217),(-.144,0,0),1,p,.006)
for z in [-.072,-.036,.036,.072]:box('Raised spine band',(.020,.056,.008),(-.144,0,z),1,p,.002)
for y in [-.016,-.011,-.006,-.001,.004,.009,.014]:box('Layered paper signatures',(.281,.0006,.204),(.004,y,0),4,p,.0001)
for x in [-.125,.125]:box('Gilt cover line',(.0014,.001,.184),(x,.028,0),3,p,.00015)
for z in [-.092,.092]:box('Gilt cover line',(.252,.001,.0014),(0,.028,z),3,p,.00015)
box('Woven bookmark tail',(.01,.0012,.039),(.09,.022,.118),2,p,.00025)
for p in models.values():p['assetVersion']='1.0.0'
# Export material batches by transform parent, retain editable source pieces in the blend.
bpy.context.view_layer.update();sourceParts=list(parts);EXPORT=bpy.data.collections.new('Office export batches');bpy.context.scene.collection.children.link(EXPORT);exports=[];parents=[kit,*models.values(),cover]
clones={}
for p in parents:
 n=p.copy();n.name=p.name+'__EXPORT';EXPORT.objects.link(n);clones[p]=n;n.parent=clones.get(p.parent);n.location=p.location.copy();n.rotation_euler=p.rotation_euler.copy();n.scale=(1,1,1)
from collections import defaultdict
groups=defaultdict(list)
for o in sourceParts:groups[(o.parent,int(o['materialTile']))].append(o)
for (parent,q),obs in groups.items():
 dup=[]
 for o in obs:
  n=o.copy();n.data=o.data.copy();EXPORT.objects.link(n);n.parent=clones[parent];n.matrix_basis=o.matrix_basis.copy();dup.append(n)
 for o in bpy.context.selected_objects:o.select_set(False)
 for o in dup:o.select_set(True)
 bpy.context.view_layer.objects.active=dup[0];bpy.ops.object.join();n=dup[0];n.name=parent.name+'_'+str(q);exports.append(n);n.select_set(False)
# Names during export must be exactly contract; restore source names immediately after.
oldNames={p:p.name for p in parents}
for p in parents:p.name=p.name+'__EDITABLE'
for p,n in clones.items():n.name=oldNames[p]
for o in bpy.context.selected_objects:o.select_set(False)
for o in [*clones.values(),*exports]:o.select_set(True)
bpy.context.view_layer.objects.active=clones[kit]
for im in [baseim,normim,ormim]:im.pack()
bpy.ops.export_scene.gltf(filepath=OUT+'/office-kit.glb',export_format='GLB',use_selection=True,export_yup=True,export_apply=False,export_extras=True,export_materials='EXPORT',export_cameras=False,export_lights=False)
triangles=sum(sum(len(f.vertices)-2 for f in o.data.polygons)for o in exports)
report={'assetVersion':'1.0.0','kitId':'restore-retro-office','glb':'office-kit.glb','glbBytes':os.path.getsize(OUT+'/office-kit.glb'),'glbSha256':hashlib.sha256(open(OUT+'/office-kit.glb','rb').read()).hexdigest(),'triangles':triangles,'renderMeshes':len(exports),'editableParts':len(sourceParts),'materials':len(mats),'atlasImages':[{'name':im.name,'size':list(im.size)}for im in [baseim,normim,ormim]],'refinedAtlas':args.final,'models':{}}
for p in models.values():
 obs=[o for o in sourceParts if o.parent==p or o.parent.parent==p];points=[o.matrix_world@v.co for o in obs for v in o.data.vertices];lo=[min(v[i]for v in points)for i in range(3)];hi=[max(v[i]for v in points)for i in range(3)];report['models'][oldNames[p]]={'origin':p.get('origin',''),'boundsMin':[lo[0],lo[2],-hi[1]],'boundsMax':[hi[0],hi[2],-lo[1]],'triangles':sum(sum(len(f.vertices)-2 for f in o.data.polygons)for o in obs),'editableParts':len(obs)}
with open(ART+'/asset-report.json','w')as f:json.dump(report,f,indent=2)
for o in list(EXPORT.objects):bpy.data.objects.remove(o,do_unlink=True)
bpy.data.collections.remove(EXPORT)
for p,n in oldNames.items():p.name=n
print('OFFICE_EXPORT_READY '+json.dumps({k:report[k]for k in ['glbBytes','triangles','renderMeshes','editableParts','refinedAtlas']}),flush=True)
# Independent four-angle views, each captures actual Blender model. No geometry offsets in source.
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=16;scene.cycles.use_denoising=True;scene.render.resolution_x=512;scene.render.resolution_y=512;scene.render.resolution_percentage=100;scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGBA';scene.world.color=(.18,.18,.18);scene.view_settings.view_transform='AgX';scene.render.film_transparent=False
ST=bpy.data.collections.new('Office render studio');scene.collection.children.link(ST)
def studio(o):
 for c in list(o.users_collection):c.objects.unlink(o)
 ST.objects.link(o);return o
bpy.ops.mesh.primitive_plane_add(size=200);ground=studio(bpy.context.object);ground.name='Office studio ground';gm=bpy.data.materials.new('Office studio neutral');gm.use_nodes=True;gm.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value=(.065,.074,.076,1);gm.node_tree.nodes.get('Principled BSDF').inputs['Roughness'].default_value=.82;ground.data.materials.append(gm)
lights=[]
for name,pos,energy,size,color in [('Warm key',(-2,-3,4),650,4,(1,.89,.74)),('Cool fill',(3,-1,2.4),400,3,(.77,.86,1)),('Warm rim',(-1,3,3.5),850,3,(1,.91,.8))]:
 d=bpy.data.lights.new(name,'AREA');d.energy=energy;d.shape='DISK';d.size=size;d.color=color;o=bpy.data.objects.new(name,d);ST.objects.link(o);o.location=pos;lights.append((o,Vector(pos),energy,size))
d=bpy.data.cameras.new('Office review camera');camera=bpy.data.objects.new('Office review camera',d);ST.objects.link(camera);scene.camera=camera;d.type='ORTHO'
def show_model(name):
 p=models[name]
 for o in sourceParts:o.hide_render=not(o.parent==p or o.parent.parent==p)
 obs=[o for o in sourceParts if not o.hide_render];bpy.context.view_layer.update();pts=[o.matrix_world@Vector(v)for o in obs for v in o.bound_box];lo=Vector([min(v[i]for v in pts)for i in range(3)]);hi=Vector([max(v[i]for v in pts)for i in range(3)]);center=(lo+hi)/2;extent=max(hi-lo);ground.location.z=lo.z-.003
 for o,pos,e,s in lights:
  o.location=center+pos*extent*.7;o.data.energy=e*extent*extent*.5;o.data.size=s*extent*.65;o.rotation_euler=(center-o.location).to_track_quat('-Z','Y').to_euler()
 return center,extent

def render_sheet(name,opened=False):
 center,extent=show_model(name);scale=extent*1.43;d.ortho_scale=scale;result=np.ones((1024,1024,4),np.float32)
 for i,direction in enumerate([(1,-1,.82),(-1,-1,.66),(-1,1,.8),(1,1,.45)]):
  camera.location=center+Vector(direction)*extent*2;camera.rotation_euler=(center-camera.location).to_track_quat('-Z','Y').to_euler();path=ART+'/renders/'+name.lower()+('-open'if opened else'')+'-'+str(i+1)+'.png';scene.render.filepath=path;bpy.ops.render.render(write_still=True);im=bpy.data.images.load(path,check_existing=False);arr=np.array(im.pixels[:],np.float32).reshape((512,512,4));row=1-i//2;col=i%2;result[row*512:(row+1)*512,col*512:(col+1)*512]=arr;bpy.data.images.remove(im);os.remove(path)
 image_write(name+' four angles',result,ART+'/renders/'+name.lower()+('-open'if opened else'')+'-four-angles.png','sRGB');print('OFFICE_SHEET_READY '+name,flush=True)
# Save the EDITABLE source as a readable office vignette after identity-template export.
# Runtime origins stay identity because export and measurements happened before this stage.
staging={'Desk':(-1.45,0,0),'Drawer':(-1.45,.70,.61),'Notebook':(-1.25,.973,.10),'LockerShell':(1.40,0,-.35),'LockerDoor':(.75,0,-.005),'Chair':(-1.6,.59,1.15),'Pen':(-.73,.98,.24),'Pencil':(-.77,.98,.34),'Logbook':(-.54,1.0,-.19)}
for name,pos in staging.items():models[name].location=C(pos)
models['LockerDoor'].rotation_euler.z=-.70
models['Notebook'].rotation_euler.z=.08
bpy.context.view_layer.update()
for o in sourceParts:o.hide_render=False
ground.location.z=-.003
for o,pos,e,s in lights:
 o.location=Vector((0,0,.8))+pos*1.6;o.data.energy=e*2.5;o.data.size=s*1.4;o.rotation_euler=(Vector((0,0,.8))-o.location).to_track_quat('-Z','Y').to_euler()
camera.location=(4,-6,4);camera.rotation_euler=(Vector((-.1,0,.9))-camera.location).to_track_quat('-Z','Y').to_euler();d.ortho_scale=6.15
bpy.ops.wm.save_as_mainfile(filepath=ART+'/restore-office-kit.blend')
if not args.skip_renders:
 scene.render.resolution_x=1400;scene.render.resolution_y=1000;scene.render.filepath=ART+'/renders/office-kit-overview.png';bpy.ops.render.render(write_still=True);scene.render.resolution_x=512;scene.render.resolution_y=512
 # Restore template orientations for consistent isolated angle sheets.
 models['LockerDoor'].rotation_euler.z=0;models['Notebook'].rotation_euler.z=0
 for name in models:render_sheet(name)
 cover.rotation_euler.y=-2.15;render_sheet('Notebook',True);cover.rotation_euler.y=0
 for o in sourceParts:o.hide_render=False
 print('OFFICE_ALL_RENDERS_READY',flush=True)
