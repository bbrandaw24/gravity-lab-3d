"""Read the public, uncompressed float64 GeoTIFF and polygon without GIS dependencies."""
import struct, json, hashlib, pathlib
import numpy as np

root = pathlib.Path(__file__).parent
b = (root/'data/avaAlr.tif').read_bytes()
off = struct.unpack_from('<I', b, 4)[0]
n = struct.unpack_from('<H', b, off)[0]
tags = {}
for i in range(n):
    pos = off+2+i*12
    tag, typ, count, ptr = struct.unpack_from('<HHII', b, pos)
    fmt, size = {1:('B',1),2:('c',1),3:('H',2),4:('I',4),12:('d',8)}[typ]
    raw = b[pos+8:pos+8+count*size] if count*size<=4 else b[ptr:ptr+count*size]
    tags[tag] = struct.unpack('<'+fmt*count,raw)
assert tags[259][0] == 1 and tags[258][0] == 64
raw = b''.join(b[o:o+c] for o,c in zip(tags[273],tags[279]))
arr = np.frombuffer(raw, dtype='<f8').reshape(tags[257][0], tags[256][0])
nodata = arr < -9000
from scipy.ndimage import distance_transform_edt
# Fill only for interpolating edge normals; retain the validity mask, hide invalid
# triangles in the renderer, and remove exiting particles from the active domain.
if nodata.any():
    nearest = distance_transform_edt(nodata, return_distances=False, return_indices=True)
    arr = arr[tuple(nearest)]
scale, tie = tags[33550], tags[33922]
x0, north0 = tie[3]+scale[0]/2, tie[4]-scale[1]/2
s = (root/'data/relAlr.shp').read_bytes()[108:]
nparts,npoints = struct.unpack_from('<ii',s,36)
start = 44+4*nparts
poly = [list(struct.unpack_from('<2d',s,start+16*i)) for i in range(npoints)]
poly = [[round(x-x0,3), round(north0-y,3)] for x,y in poly]
a = arr[::3,::3].copy()
area = abs(sum(poly[i][0]*poly[i+1][1]-poly[i+1][0]*poly[i][1] for i in range(len(poly)-1)))/2
yy,xx=np.mgrid[:arr.shape[0],:arr.shape[1]]; xx=xx*5.;yy=yy*5.
inside=np.zeros(arr.shape,dtype=bool)
for i in range(len(poly)-1):
    x1,y1=poly[i];x2,y2=poly[i+1]
    if y1!=y2:
        inside ^= ((y1>yy)!=(y2>yy)) & (xx < (x2-x1)*(yy-y1)/(y2-y1)+x1)
gy,gx=np.gradient(arr,5.)
surface=float(np.sqrt(1+gx[inside]**2+gy[inside]**2).sum()*25)
out={'nx':a.shape[1],'ny':a.shape[0],'cell':15,'originalCell':5,
     'width':(a.shape[1]-1)*15,'length':(a.shape[0]-1)*15,
     'zmin':round(float(a.min()),2),'zmax':round(float(a.max()),2),
     'originEast':x0,'originNorth':north0,'crs':'MGI / Austria Lambert',
     'releasePolygon':poly,'releasePlanArea':round(area,2),'releaseSurfaceArea':round(surface,2),
     'sourceCommit':'c745a2dec4a7978ac9a8ef100068fae7f6db6d13',
     'sourceSHA256':hashlib.sha256(b).hexdigest(),
     'valid':(~nodata[::3,::3]).astype(int).flatten().tolist(),
     'elevation':np.round(a,2).flatten().tolist()}
(root/'dist/terrain.json').write_text(json.dumps(out,separators=(',',':')))
print(json.dumps({k:v for k,v in out.items() if k not in ['elevation','releasePolygon','valid']}))
