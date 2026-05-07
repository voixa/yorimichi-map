FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PORT=8080

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY . ./

EXPOSE 8080

# 1 worker, 4 threads — Cloud Run でスケールするので少なめでOK
CMD exec gunicorn --bind :$PORT --workers 1 --threads 4 --timeout 30 main:app
