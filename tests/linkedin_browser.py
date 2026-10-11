"""LinkedIn review through both interview modes using deterministic provider fixtures.

Start Chrome with --headless --remote-debugging-port=9223,
then run: .venv/bin/python tests/linkedin_browser.py
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
            if self.path == '/api/linkedin-review':
                section = {'original': 'Student building web apps', 'score': 6, 'explanation': 'Clear focus.', 'suggestion': 'Web app builder | Student'}
                missing = {'original': '', 'score': None, 'explanation': 'Not provided', 'suggestion': None}
                result = {'overall_score': 60, 'headline': section, 'about': missing, 'experience': missing, 'skills': missing, 'strengths': ['Clear', 'Concise', 'Focused'], 'improvements': ['Add About', 'Add experience', 'Add skills']}
            elif self.path == '/api/questions':
                result = {'questions': [f'Tell me about decision {i} and the results of your work?' for i in range(1, 6)]}
            elif self.path == '/api/interview-followup':
                time.sleep(followup_delay)
                result = {'question': ''}
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
    js("location.hash='linkedin'; linkedInText.value='Student building web apps'; linkedInText.dispatchEvent(new Event('input'))")
    click('review-linkedin')
    wait("!linkedInResult.hidden")
    check("linkedInResult.textContent.includes('60 / 100') && linkedInResult.textContent.includes('About: Not provided')", 'scores and missing sections')
    check("linkedInResult.querySelectorAll('.linkedin-rewrite button').length === 1", 'only provided sections have copy buttons')
    js("window.__copied=''; navigator.clipboard.writeText=async text=>{window.__copied=text}; linkedInResult.querySelector('.linkedin-rewrite button').click()")
    wait("window.__copied === 'Web app builder | Student'")
    js("linkedInResult.lastElementChild.click()")
    check("location.hash === '#interview' && linkedInProfile === 'Student building web apps' && !setupForm.hidden", 'practice navigation preserves context and settings')
    js("modeSelect.value='guided'; setupForm.requestSubmit()")
    wait("!interviewScreen.hidden")
    for i in range(5):
        js("answerBox.value='I built web apps using Python and tested the user flows.'; answerBox.dispatchEvent(new Event('input')); submitButton.click()")
        wait("!nextButton.hidden")
        js("nextButton.click()")
    wait("!resultsScreen.hidden && feedbackText.textContent.includes('Describe the tests')")
    for endpoint in ('/api/questions', '/api/answer-feedback', '/api/feedback'):
        payloads = [data for path, data in requests if path == endpoint]
        assert payloads and all(data['linkedin_text'] == 'Student building web apps' for data in payloads), endpoint
    print('PASS guided questions, all five answers and final feedback preserve LinkedIn context')
    load()
    js("linkedInText.value='Student building web apps'; linkedInText.dispatchEvent(new Event('input'))")
    click('review-linkedin')
    wait("!linkedInResult.hidden")
    js("linkedInResult.lastElementChild.click()")
    join()
    wait("!document.getElementById('mock-response').disabled")
    js("document.getElementById('mock-response').value='I built web apps with Python.'; document.getElementById('mock-response').dispatchEvent(new Event('input'))")
    click('mock-done')
    wait("document.getElementById('mock-call').dataset.state !== 'processing_answer'")
    click('mock-end')
    wait("!resultsScreen.hidden")
    wait("feedbackText.textContent.includes('Describe the tests')")
    assert any(path == '/api/feedback' and data.get('mode') == 'mock' and data['linkedin_text'] == 'Student building web apps' for path, data in requests)
    print('PASS mock questions and feedback preserve LinkedIn context')
    assert not exceptions, exceptions
finally:
    ws.close()
    server.shutdown()
