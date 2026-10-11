"""Local camera-coaching regression tests; requires Chrome debugging on port 9223.
Run .venv/bin/python tests/camera_browser.py with Chrome fake-media flags.
Real MediaPipe models run on a generated test video; behavioral thresholds use
synthetic landmarks. No actual webcam or paid service is used.
"""
import base64
import json
import sys
from pathlib import Path
import threading
import time
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from websockets.sync.client import connect

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = Path(sys.argv[1]) if len(sys.argv) > 1 else None
class Handler(SimpleHTTPRequestHandler):
    def __init__(self,*args,**kwargs):
        super().__init__(*args,directory=str(ROOT/'Frontend'),**kwargs)
    def log_message(self,*args): pass
    def do_GET(self):
        if self.path == '/test-portrait.jpg' and FIXTURE:
            image=FIXTURE.read_bytes()
            self.send_response(200); self.send_header('Content-Type','image/jpeg')
            self.send_header('Content-Length',str(len(image))); self.end_headers()
            self.wfile.write(image)
        else: super().do_GET()
server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
threading.Thread(target=server.serve_forever,daemon=True).start()
targets=json.load(urllib.request.urlopen('http://127.0.0.1:9223/json'))
ws=connect(next(t['webSocketDebuggerUrl'] for t in targets if t['type']=='page'),max_size=10_000_000)
seq=0
errors=[]
def cdp(method,params=None):
    global seq
    seq+=1
    ws.send(json.dumps({'id':seq,'method':method,'params':params or {}}))
    while True:
        reply=json.loads(ws.recv(timeout=60))
        if reply.get('method')=='Runtime.exceptionThrown': errors.append(reply['params'])
        if reply.get('id')==seq:
            assert 'error' not in reply,reply
            return reply.get('result',{})
def js(expression):
    result=cdp('Runtime.evaluate',{'expression':expression,'returnByValue':True,'awaitPromise':True,'userGesture':True})
    assert 'exceptionDetails' not in result,result
    return result['result'].get('value')
def wait(expression,timeout=50):
    until=time.monotonic()+timeout
    while time.monotonic()<until:
        if js(expression): return
        time.sleep(.15)
    raise AssertionError(expression+' / '+str(js("document.querySelector('.camera-coach-setup [data-coach-status]')?.textContent")))
def check(expression,name):
    assert js(expression),name
    print('PASS',name,flush=True)
try:
    cdp('Page.enable'); cdp('Runtime.enable')
    cdp('Emulation.setDeviceMetricsOverride',{'width':1440,'height':1000,'deviceScaleFactor':1,'mobile':False})
    cdp('Page.navigate',{'url':f'http://127.0.0.1:{server.server_port}/'})
    wait('Boolean(window.CameraSignals && window.mockInterview)')
    js("window.s=new CameraSignals(); window.f={faceCount:1,framed:true,eyesOpen:true,yaw:.5,pitch:.25,gaze:.5,body:null}; s.calibrate(); for(let t=0;t<=3250;t+=250)s.observe(f,t,false)")
    check('s.baseline !== null && s.summary().observedMs === 0','three-second calibration excludes pre-call metrics')
    js('for(let t=3500;t<=7000;t+=250)s.observe({...f,gaze:.9},t); s.observe(f,7250)')
    check('s.summary().counts.away === 0','brief glances do not trigger look-away cues')
    js('for(let t=7500;t<=12500;t+=250)s.observe({...f,gaze:.9},t)')
    check('s.summary().counts.away === 1','sustained calibrated look-away produces one cue')
    js('for(let t=12750;t<=22000;t+=250)s.observe({...f,gaze:.9},t)')
    check('s.summary().counts.away === 1','continuous condition is not counted repeatedly')
    js('s.pause(); s.observe(f,120000)')
    check('s.summary().observedMs < 25000','camera-off intervals excluded from observation time')
    js('window.b=new CameraSignals(); for(let t=0;t<=15000;t+=250)b.observe({...f,gaze:.9},t)')
    check('b.summary().counts.away === 0','look-away cues require calibration')
    js('window.m=new CameraSignals(); for(let t=0;t<=18000;t+=250)m.observe({...f,body:{center:{x:.5,y:.4},scale:.4,wrists:[{x:(t/250)%2?.1:-.1,y:.5},null]}},t)')
    check('m.summary().counts.movement === 1','repeated visible movement produces a sustained cue')
    js('window.n=new CameraSignals(); for(let t=0;t<=5000;t+=250)n.observe({faceCount:0},t)')
    check('n.summary().counts.missing === 1 && n.summary().counts.away === 0','no-face signal never becomes an eye-contact claim')
    # Opt in through real app controls and exercise the actual CPU models/worker.
    check("!document.getElementById('camera-coach-enable').checked",'camera analysis is opt-in')
    js("document.getElementById('camera-coach-enable').click(); document.getElementById('mock-preview-camera').click()")
    wait("document.querySelector('.camera-coach-setup [data-calibrate]').disabled === false")
    wait("document.querySelector('.camera-coach-setup [data-coach-status]').textContent.includes('Calibrate while')")
    print('PASS real local MediaPipe models initialize and process camera frames',flush=True)
    if FIXTURE:
        js("window.fixtureWorker=new Worker('camera-coach-worker.js'); window.fixtureReady=false; window.fixtureResult=null; fixtureWorker.onmessage=e=>{if(e.data.type==='ready')fixtureReady=true;else fixtureResult=e.data}; fixtureWorker.postMessage({type:'init'})")
        wait('fixtureReady || fixtureResult')
        check('fixtureReady','fixture model initializes')
        js("(async()=>{const image=await createImageBitmap(await (await fetch('/test-portrait.jpg')).blob()); fixtureWorker.postMessage({type:'frame',frame:image,timestamp:performance.now()},[image]);})()")
        wait('fixtureResult !== null')
        check("fixtureResult.type==='sample' && fixtureResult.features.faceCount === 1 && ['yaw','pitch','gaze'].every(key=>Number.isFinite(fixtureResult.features[key]))",'real face fixture produces usable direction landmarks')
        js('fixtureWorker.terminate()')
    js("window.track=document.getElementById('mock-pre-video').srcObject.getTracks()[0]; document.getElementById('mock-preview-camera').click()")
    check("track.readyState==='ended' && document.querySelector('.camera-coach-setup [data-calibrate]').disabled",'camera off stops capture and disables coaching')
    # Separate controller with synthetic observations verifies final review and resets.
    js("window.box=document.createElement('div'); document.body.append(box); window.coach=new CameraCoach({preflight:box,stage:box,toolbar:box,results:document.getElementById('results-screen'),video:()=>document.getElementById('mock-camera'),recording:()=>true}); coach.signals=s; coach.finish()")
    check("!coach.review.hidden && coach.review.textContent.includes('1 sustained look-away cue')",'post-interview review uses observed cue counts')
    check("coach.review.textContent.includes('not an eye-contact score')",'review explains uncertainty')
    js('coach.camera(false)')
    check('coach.signals.baseline === null && coach.signals.summary().calibrated', 'camera off clears calibration but preserves observed review evidence')
    js('coach.begin()')
    check('coach.review.hidden && coach.signals.summary().counts.away === 0','new interview resets camera review')
    js("coach.signals.observe(f,0); coach.signals.observe(f,250); coach.finish()")
    check("coach.review.textContent.includes('wasn’t enough analyzed camera time')",'short sessions do not invent camera feedback')
    js("box.remove(); coach.review.remove(); document.getElementById('interview-mode').value='guided'; document.getElementById('interview-mode').dispatchEvent(new Event('change'))")
    check("document.querySelector('.mock-preflight').hidden && !document.getElementById('mock-call').open",'camera coaching stays outside Guided Practice')
    assert not errors,errors
    print('PASS no uncaught browser errors',flush=True)
finally:
    ws.close(); server.shutdown()
