#!/usr/bin/env python3
"""Busca transcrição de um vídeo do YouTube."""

import sys
from youtube_transcript_api import YouTubeTranscriptApi
from youtube_transcript_api._errors import TranscriptsDisabled, NoTranscriptFound

def get_transcript(video_id: str, languages: list[str] = None):
    if languages is None:
        languages = ['pt', 'en']

    print(f"Buscando transcrição para vídeo: {video_id}")
    print(f"Línguas: {languages}")
    print("-" * 50)

    try:
        api = YouTubeTranscriptApi()
        transcript = api.fetch(video_id, languages=languages)

        for line in transcript:
            print(f"[{line.start:.1f}s] {line.text}")

        print("-" * 50)
        print(f"Total: {len(transcript)} linhas")

    except TranscriptsDisabled:
        print("ERRO: Transcrição desabilitada para este vídeo")
        sys.exit(1)
    except NoTranscriptFound:
        print("ERRO: Nenhuma transcrição encontrada nestas línguas")
        print("Tentando sem especificar língua...")
        try:
            transcript = YouTubeTranscriptApi.list_transcripts(video_id)
            print("Transcrições disponíveis:")
            for t in transcript:
                print(f"  - {t.language_code}: {t.language}")
        except Exception as e:
            print(f"Erro ao listar: {e}")
        sys.exit(1)

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Uso: python get_transcript.py <video_id>")
        print("Exemplo: python get_transcript.py 8NOxb2WV95I")
        sys.exit(1)

    video_id = sys.argv[1]
    get_transcript(video_id)