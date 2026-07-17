# Sole process binds :7860 — Gradio SDK would also bind and crash with EADDRINUSE.
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PORT=7860

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py lobbies.py relay.py ./

EXPOSE 7860

CMD ["python", "app.py"]
