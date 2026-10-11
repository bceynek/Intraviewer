"""Browser integration checks against local assets and deterministic provider fixtures.

Start Chrome with --headless --remote-debugging-port=9223 and fake media devices,
then run: .venv/bin/python tests/scribe_browser.py
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
        raw = self.rfile.read(int(self.headers['Content-Length']))
        data = {} if self.path == '/api/transcribe' else json.loads(raw)
        requests.append((self.path, data))
        if self.path == '/api/narrate':
            body, mime = wav.getvalue(), 'audio/wav'
        else:
            if self.path == '/api/transcribe':
                result = {'text': 'I built an API.'}
            elif self.path == '/api/questions':
                result = {'questions': [f'Tell me about decision {i} and the results of your work?' for i in range(1, 6)]}
            elif self.path == '/api/interview-followup':
                time.sleep(followup_delay)
                result = {'question': 'What did you personally change?' if len(data['history']) == 1 else ''}
            elif self.path == '/api/answer-feedback':
                result = {'strongest_point': 'You identify your contribution.',
                          'biggest_improvement': 'Describe the tests you added.',
                          'quoted_example': data['answer'], 'suggested_rewrite': 'My contribution was building the feature.'}
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


cdp('Runtime.enable')
cdp('Page.enable')
cdp('Page.addScriptToEvaluateOnNewDocument', {'source': """
window.SpeechRecognition = class {
  start() { window.__live = this; }
  abort() {}
  emit(text) { this.onresult({results: [[{transcript: text}]]}); }
};
"""})
try:
    load()
    js("modeSelect.value='guided'; setupForm.requestSubmit()")
    wait("!interviewScreen.hidden")
    js("speechButton.click()")
    wait("speechStatus.textContent.startsWith('Recording')")
    time.sleep(.2)
    js("window.__live.emit('I built a draft.')")
    check("answerBox.value === 'I built a draft.'", 'live words appear in the answer box')
    check("Boolean(recognition) && submitButton.disabled", 'submission blocked during recording')
    js("speechButton.click()")
    wait("recognition === null")
    check("answerBox.value === 'I built an API.' && !submitButton.disabled", 'Scribe replaces live draft without duplicating it')
    js("speechButton.click()")
    wait("speechStatus.textContent.startsWith('Recording')")
    js("cancelDictation()")
    time.sleep(.2)
    check("recognition === null && answerBox.value === 'I built an API.'", 'cancellation preserves text')
    load()
    join()
    wait("document.getElementById('mock-call').dataset.state === 'user_speaking'")
    time.sleep(.2)
    click('mock-done')
    wait("document.getElementById('mock-call').dataset.state === 'ai_speaking'")
    assert any(path == '/api/interview-followup' and data['history'][-1]['answer'] == 'I built an API.' for path, data in requests)
    print('PASS mock waits for transcription before submitting')
    assert not exceptions, exceptions
finally:
    ws.close()
    server.shutdown()
