#!/usr/bin/env python3
"""Audit an explicit URL override against the existing public ColabFold service.

Remote qualification only. Explicit HTTPS port 443 preserves the same service
while making a silently ignored --host-url observable at Requests' send boundary.
Query bodies, headers, credentials and ticket identifiers are never recorded.
"""
from __future__ import annotations

import argparse
from contextlib import contextmanager
import json
from pathlib import Path
import sys
from urllib.parse import urlsplit


PUBLIC_OVERRIDE = 'https://api.colabfold.com:443'
UNUSABLE_OVERRIDE = 'https://forge-af2-unusable.invalid'


def route(path: str) -> str:
    if path in ('/ticket/msa', '/ticket/pair'):
        return path
    if path.startswith('/result/download/'):
        return '/result/download/{id}'
    if path.startswith('/ticket/'):
        return '/ticket/{id}'
    if path.startswith('/template/'):
        return '/template/{ids}'
    raise ValueError('Unexpected route in the bounded public override qualification')


@contextmanager
def audit_transport(path: Path, expected: str = PUBLIC_OVERRIDE):
    import requests

    original = requests.Session.send
    with path.open('x') as stream:
        def send(session, request, **kwargs):
            parsed = urlsplit(request.url)
            selected = urlsplit(expected)
            if (parsed.scheme != selected.scheme or parsed.netloc != selected.netloc
                    or parsed.username or parsed.password or parsed.query or parsed.fragment):
                stream.write(json.dumps({'event': 'unexpected_endpoint', 'method': request.method,
                                         'observed_host': parsed.hostname}) + '\n')
                stream.flush()
                raise ValueError('Native request ignored the explicit URL or attempted another service')
            item = {'event': 'request', 'method': request.method, 'origin': expected, 'route': route(parsed.path)}
            stream.write(json.dumps(item) + '\n')
            stream.flush()
            try:
                return original(session, request, **kwargs)
            except requests.RequestException as error:
                stream.write(json.dumps({'event': 'transport_error', 'type': type(error).__name__}) + '\n')
                stream.flush()
                raise

        requests.Session.send = send
        try:
            yield
        finally:
            requests.Session.send = original


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('audit', type=Path)
    parser.add_argument('phase', choices=('search', 'predict'))
    parser.add_argument('native_args', nargs=argparse.REMAINDER)
    args = parser.parse_args()
    native_args = args.native_args
    if native_args and native_args[0] == '--':
        native_args = native_args[1:]
    if native_args.count('--host-url') != 1:
        parser.error('Select the explicit public URL once')
    position = native_args.index('--host-url')
    if position + 1 == len(native_args) or native_args[position + 1] not in (PUBLIC_OVERRIDE, UNUSABLE_OVERRIDE):
        parser.error('Select the existing public :443 service or the reserved unusable .invalid test target')
    selected = native_args[position + 1]
    from colabfold.batch import main as native_main

    sys.argv = ['colabfold_batch', *native_args]
    with audit_transport(args.audit, selected):
        native_main()
    items = [json.loads(line) for line in args.audit.read_text().splitlines()]
    if any(x['event'] == 'unexpected_endpoint' for x in items):
        raise ValueError('Native client attempted another endpoint')
    if any(x['event'] == 'transport_error' for x in items):
        raise ValueError('Explicit endpoint had transport failures; native skipped-query exit zero is insufficient')
    if args.phase == 'search':
        if not any(x['event'] == 'request' and x['method'] == 'POST' and x['route'] in ('/ticket/msa', '/ticket/pair') for x in items):
            raise ValueError('Fresh search did not submit a native ticket')
        if not any(x['event'] == 'request' and x['route'] == '/result/download/{id}' for x in items):
            raise ValueError('Fresh search did not download its native result')
    elif items:
        raise ValueError('Saved-MSA/template prediction unexpectedly submitted network requests')


if __name__ == '__main__':
    main()
