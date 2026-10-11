"""Browser integration checks against local assets and deterministic provider fixtures.

Start Chrome with --headless --remote-debugging-port=9223 and fake media devices,
then run: .venv/bin/python tests/mock_browser.py
No provider keys, real microphone input, or external API requests are used.
"""
import base64
import io
import json
from pathlib import Path
import threading
import time
import urllib.request
import wave
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from websockets.sync.client import connect

ROOT = Path(__file__).resolve().parents[1]
requests = []
followup_delay = 0
wav = io.BytesIO()
with wave.open(wav, 'wb') as audio:
    audio.setnchannels(1)
    audio.setsampwidth(2)
    audio.setframerate(8000)
    audio.writeframes(b'\0\0' * 16000)


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT / 'Frontend'), **kwargs)

    def log_message(self, *args):
        pass

    def do_POST(self):
        data = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        requests.append((self.path, data))
        if self.path == '/api/narrate':
            body, mime = wav.getvalue(), 'audio/wav'
        else:
            if self.path == '/api/questions':
                result = {'questions': [f'Tell me about decision {i} and the results of your work?' for i in range(1, 6)]}
            elif self.path == '/api/interview-followup':
                time.sleep(followup_delay)
                result = {'question': 'What did you personally change?' if len(data['history']) == 1 else ''}
            else:
                result = {'feedback': 'Describe the tests you added and explain which failures they prevented.'}
            body, mime = json.dumps(result).encode(), 'application/json'
        self.send_response(200)
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)


server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
threading.Thread(target=server.serve_forever, daemon=True).start()
targets = json.load(urllib.request.urlopen('http://127.0.0.1:9223/json'))
ws = connect(next(t['webSocketDebuggerUrl'] for t in targets if t['type'] == 'page'), max_size=10_000_000)
seq = 0
exceptions = []


def cdp(method, params=None):
    global seq
    seq += 1
    ws.send(json.dumps({'id': seq, 'method': method, 'params': params or {}}))
    while True:
        reply = json.loads(ws.recv(timeout=15))
        if reply.get('method') == 'Runtime.exceptionThrown':
            exceptions.append(reply['params'])
        if reply.get('id') == seq:
            if 'error' in reply:
                raise AssertionError(reply['error'])
            return reply.get('result', {})


def js(expression):
    result = cdp('Runtime.evaluate', {'expression': expression, 'returnByValue': True, 'awaitPromise': True, 'userGesture': True})
    if 'exceptionDetails' in result:
        raise AssertionError(result['exceptionDetails'])
    return result['result'].get('value')


def wait(expression, timeout=8):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if js(expression):
            return
        time.sleep(.06)
    raise AssertionError(f'Timed out: {expression}; state=' + str(js("document.getElementById('mock-state')?.textContent + ' / ' + document.getElementById('mock-notice')?.textContent")))


def check(expression, label):
    assert js(expression), label
    print('PASS', label, flush=True)


def click(id):
    js(f"document.getElementById({json.dumps(id)}).click()")


def load():
    cdp('Page.navigate', {'url': f'http://127.0.0.1:{server.server_port}/'})
    wait('Boolean(window.mockInterview)')
    js("document.getElementById('role').value='Software engineer'; document.getElementById('experience').value='entry'; window.confirm=()=>true")


def join():
    js("document.getElementById('setup-form').requestSubmit()")
    wait("document.getElementById('mock-call').dataset.state === 'ai_speaking'")


def respond(text='I added integration tests and reduced regressions.'):
    wait("document.getElementById('mock-call').dataset.state === 'user_speaking'")
    js(f'window.__speech.finalize({json.dumps(text)})')
    click('mock-done')


cdp('Runtime.enable')
cdp('Page.enable')
cdp('Emulation.setDeviceMetricsOverride', {'width':1440,'height':1000,'deviceScaleFactor':1,'mobile':False})
cdp('Emulation.setEmulatedMedia', {'features':[{'name':'prefers-reduced-motion','value':'no-preference'}]})
cdp('Page.addScriptToEvaluateOnNewDocument', {'source': '''
window.__starts = 0; window.__aborts = 0;
window.SpeechRecognition = class {
  start() { window.__speech = this; window.__starts++; this.active = true; queueMicrotask(() => {if(this.active) this.onstart?.();}); }
  stop() { this.active = false; queueMicrotask(() => this.onend?.()); }
  abort() { window.__aborts++; this.active = false; queueMicrotask(() => this.onend?.()); }
  finalize(text) { const result = [{transcript:text}]; result.isFinal=true; this.onresult({resultIndex:0,results:[result]}); }
  fail() { this.onerror({error:'network'}); this.stop(); }
};
'''})
try:
    load()
    check("document.querySelector('.mock-preflight').hidden === false", 'mock pre-call setup visible')
    click('mock-preview-camera')
    wait("document.getElementById('mock-pre-video').srcObject !== null")
    js("window.__cameraTrack=document.getElementById('mock-pre-video').srcObject.getTracks()[0]")
    click('mock-preview-camera')
    check("window.__cameraTrack.readyState === 'ended'", 'camera off releases stream')
    join()
    check("document.getElementById('mock-stage').classList.contains('is-speaking') && window.__starts === 0", 'actual audio playback animates image without STT')
    wait("!document.getElementById('mock-captions').hidden")
    check("document.getElementById('mock-captions').textContent.length < 100", 'short timed captions')
    click('mock-caption-toggle')
    check("document.getElementById('mock-captions').hidden && !narrators.at(-2).audio.paused", 'captions off keeps audio playing')
    click('mock-caption-toggle')
    screenshot = cdp('Page.captureScreenshot', {'format': 'png'})
    Path('/tmp/intraviewer-call-desktop.png').write_bytes(base64.b64decode(screenshot['data']))
    wait("document.getElementById('mock-call').dataset.state === 'user_speaking'")
    check("!document.getElementById('mock-stage').classList.contains('is-speaking')", 'image stops when question finishes')
    count = len([r for r in requests if r[0] == '/api/narrate'])
    js("document.getElementById('mock-recover-audio').click()")
    time.sleep(.15)
    assert len([r for r in requests if r[0] == '/api/narrate']) == count
    print('PASS delivered questions cannot replay', flush=True)
    click('mock-mute')
    check("!window.__speech.active && document.getElementById('mock-mute').getAttribute('aria-pressed') === 'true'", 'mute stops recognition')
    click('mock-mute')
    wait("document.getElementById('mock-call').dataset.state === 'user_speaking'")
    js("window.__speech.finalize('I added integration tests.'); window.__speech.fail()")
    wait("document.getElementById('mock-state').textContent.includes('Transcription stopped')")
    check("document.getElementById('mock-response').value === 'I added integration tests.'", 'transcription errors retain recognized words')
    check("document.getElementById('mock-notice').textContent.includes('standalone Google Chrome')", 'network failures explain external browser recovery')
    click('mock-done')
    wait("document.getElementById('mock-call').dataset.state === 'ai_speaking'")
    check("document.getElementById('mock-progress').textContent.includes('Follow-up 1')", 'answer reaches contextual follow-up endpoint')
    respond()
    wait("document.getElementById('mock-call').dataset.state === 'ai_speaking'")
    check("document.getElementById('mock-progress').textContent.includes('Question 2')", 'multiple turns advance reliably')
    assert len([r for r in requests if r[0] == '/api/interview-followup']) == 2
    assert len([r for r in requests if r[0] == '/api/interview-followup'][-1][1]['history']) == 2
    # Check early termination while response processing is in flight.
    followup_delay = .8
    respond('I measured the change against production error logs.')
    wait("document.getElementById('mock-call').dataset.state === 'processing_answer'")
    click('mock-end')
    wait("!document.getElementById('results-screen').hidden && !loadingFeedback")
    time.sleep(1)
    check("!document.getElementById('mock-call').open && document.getElementById('answers-list').children.length === 3", 'early end preserves pending answer and ignores stale response')
    check("narrators.at(-2).audio.paused && !window.__speech.active", 'ending stops question audio and speech capture')
    assert [r for r in requests if r[0] == '/api/feedback'][-1][1]['mode'] == 'mock'
    followup_delay = 0
    # Browser autoplay rejection and interrupted audio resume only undelivered audio.
    load()
    js("window.__originalPlay=narrators.at(-2).audio.play.bind(narrators.at(-2).audio); narrators.at(-2).audio.play=()=>{narrators.at(-2).audio.play=window.__originalPlay; return Promise.reject(new DOMException('Blocked','NotAllowedError'))}; document.getElementById('setup-form').requestSubmit()")
    wait("!document.getElementById('mock-recover-audio').hidden")
    check("window.__starts === 0", 'blocked playback never activates recognition')
    click('mock-recover-audio')
    wait("document.getElementById('mock-call').dataset.state === 'ai_speaking'")
    js("narrators.at(-2).audio.pause()")
    wait("!document.getElementById('mock-recover-audio').hidden")
    check("!document.getElementById('mock-stage').classList.contains('is-speaking')", 'interruption stops bobbing')
    click('mock-recover-audio')
    wait("document.getElementById('mock-call').dataset.state === 'user_speaking'")
    # Submission errors preserve text and allow one deliberate retry.
    js("window.__nativeFetch=window.fetch; window.fetch=(url,options)=>{ if(url==='/api/interview-followup'){window.fetch=window.__nativeFetch;return Promise.resolve(new Response(JSON.stringify({error:'Temporary failure'}),{status:503,headers:{'Content-Type':'application/json'}}))} return window.__nativeFetch(url,options) }")
    respond('My original answer must survive the network error.')
    wait("document.getElementById('mock-state').textContent.includes('submission failed')")
    check("document.getElementById('mock-response').value.includes('original answer')", 'failed submission preserves transcript')
    click('mock-done')
    wait("document.getElementById('mock-call').dataset.state === 'ai_speaking'")
    click('mock-end')
    wait('!loadingFeedback')
    # Narration service failures can retry; no automatic speech capture on error.
    load()
    js("window.__nativeFetch=window.fetch; window.fetch=(url,options)=>{ if(url==='/api/narrate'){window.fetch=window.__nativeFetch;return Promise.resolve(new Response(JSON.stringify({error:'Narration unavailable'}),{status:503,headers:{'Content-Type':'application/json'}}))} return window.__nativeFetch(url,options) }; document.getElementById('setup-form').requestSubmit()")
    wait("!document.getElementById('mock-recover-audio').hidden")
    check("document.getElementById('mock-notice').textContent.includes('Narration unavailable') && window.__starts === 0", 'narration failure has explicit recovery')
    click('mock-recover-audio')
    wait("document.getElementById('mock-call').dataset.state === 'ai_speaking'")
    click('mock-end')
    check("!document.getElementById('mock-call').open && narrators.every(n=>n.audio.paused)", 'ending during playback stops all audio')
    # Full interview completion.
    load(); join()
    for _ in range(6):
        respond()
        wait("document.getElementById('mock-call').dataset.state !== 'processing_answer'")
    wait("!document.getElementById('results-screen').hidden && !loadingFeedback")
    check("document.getElementById('answers-list').children.length === 6", 'full interview produces feedback for all turns')
    # Guided UI, voice controls, dictation and feedback are still the original flow.
    load()
    js("document.getElementById('interview-mode').value='guided'; document.getElementById('interview-mode').dispatchEvent(new Event('change'))")
    check("document.querySelector('.mock-preflight').hidden", 'mock devices hidden in Guided Practice')
    js("document.getElementById('setup-form').requestSubmit()")
    wait("!document.getElementById('interview-screen').hidden")
    check("!document.getElementById('mock-call').open && document.querySelector('#interview-screen h2').textContent === 'Guided Practice' && !document.getElementById('answer').hidden", 'guided presentation unchanged')
    js("speechButton.click()")
    wait("window.__speech?.active")
    js("window.__speech.finalize('I built the feature.'); speechButton.click()")
    wait('recognition === null')
    click('submit-answer')
    wait("document.getElementById('question-text').textContent === 'What did you personally change?'")
    js("answerBox.value='I wrote the tests.'; answerBox.dispatchEvent(new Event('input'))")
    click('submit-answer')
    wait('answerAccepted')
    check("guidedFeedback.textContent.includes('Describe the tests') && !nextButton.hidden", 'guided follow-up and feedback still work')
    # Mobile layout and reduced motion.
    cdp('Emulation.setDeviceMetricsOverride', {'width':390,'height':844,'deviceScaleFactor':1,'mobile':True})
    cdp('Emulation.setEmulatedMedia', {'features':[{'name':'prefers-reduced-motion','value':'reduce'}]})
    load(); join()
    check("getComputedStyle(document.getElementById('mock-interviewer')).animationName === 'none'", 'reduced motion respected')
    check("document.getElementById('mock-call').scrollWidth <= 390", 'mobile call has no horizontal overflow')
    screenshot = cdp('Page.captureScreenshot', {'format':'png'})
    Path('/tmp/intraviewer-call-mobile.png').write_bytes(base64.b64decode(screenshot['data']))
    click('mock-end')
    assert not exceptions, exceptions
    print('PASS no uncaught browser exceptions', flush=True)
finally:
    ws.close()
    server.shutdown()
