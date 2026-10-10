"""Read publicly exposed profile metadata without sign-in or redirect bypasses."""
import json
import re
from html.parser import HTMLParser
from urllib.parse import urlsplit

import httpx


class ProfileUnavailable(Exception):
    pass


class ProfileMetadata(HTMLParser):
    def __init__(self):
        super().__init__()
        self.capture = False
        self.current = []
        self.documents = []

    def handle_starttag(self, tag, attrs):
        if tag == 'script':
            self.capture = dict(attrs).get('type', '').lower() == 'application/ld+json'
            self.current = []

    def handle_data(self, data):
        if self.capture:
            self.current.append(data)

    def handle_endtag(self, tag):
        if tag == 'script' and self.capture:
            try:
                self.documents.append(json.loads(''.join(self.current)))
            except ValueError:
                pass
            self.capture = False


def people(value):
    if isinstance(value, list):
        for item in value:
            yield from people(item)
    elif isinstance(value, dict):
        kind = value.get('@type', [])
        if kind == 'Person' or isinstance(kind, list) and 'Person' in kind:
            yield value
        if '@graph' in value:
            yield from people(value['@graph'])
        if 'mainEntity' in value:
            yield from people(value['mainEntity'])


def describe(value):
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        return ', '.join(filter(None, map(describe, value)))
    if isinstance(value, dict):
        return '; '.join(str(value[k]) for k in ('name', 'description') if isinstance(value.get(k), str))
    return ''


def import_profile(url):
    parsed = urlsplit(url)
    host = (parsed.hostname or '').lower()
    if (parsed.scheme not in ('https', 'http')
            or not (host == 'linkedin.com' or host.endswith('.linkedin.com'))
            or parsed.username or parsed.password or parsed.port not in (None, 80, 443)
            or not re.fullmatch(r'/in/[A-Za-z0-9_%\-]+/?', parsed.path)):
        raise ValueError('Enter a LinkedIn profile URL such as https://www.linkedin.com/in/your-name.')
    # Use a fixed host, omit tracking parameters, and never follow redirects.
    canonical = 'https://www.linkedin.com' + parsed.path.rstrip('/') + '/'
    try:
        with httpx.stream('GET', canonical, timeout=15, follow_redirects=False,
                          headers={'User-Agent': 'InterviewCoach/1.0', 'Accept': 'text/html'}) as response:
            if response.status_code != 200:
                raise ProfileUnavailable('LinkedIn did not allow public access to this profile. Paste your profile text below instead.')
            chunks = []
            size = 0
            for chunk in response.iter_bytes():
                size += len(chunk)
                if size > 2_000_000:
                    raise ProfileUnavailable('This profile could not be imported. Paste your profile text below instead.')
                chunks.append(chunk)
        parser = ProfileMetadata()
        parser.feed(b''.join(chunks).decode('utf-8', errors='replace'))
        profile = next((p for doc in parser.documents for p in people(doc)), None)
        if not profile:
            raise ProfileUnavailable('No readable public profile was returned. LinkedIn may require sign-in. Paste your profile text below instead.')
        fields = ['name', 'description', 'jobTitle', 'worksFor', 'alumniOf', 'knowsAbout', 'hasOccupation']
        values = {field: describe(profile.get(field)) for field in fields}
        if not any(values[field] for field in fields[1:]):
            raise ProfileUnavailable('LinkedIn exposed no background details. Paste your profile text below instead.')
        text = '\n'.join(f'{field}: {value}' for field, value in values.items() if value)
        return {'linkedin_text': text[:15000], 'source_url': canonical,
                'truncated': len(text) > 15000}
    except httpx.HTTPError as error:
        raise ProfileUnavailable('Could not connect to LinkedIn. Try again or paste your profile text below.') from error
