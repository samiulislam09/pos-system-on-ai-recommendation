FROM python:3.12-slim

# libgomp1: OpenMP runtime required by LightGBM.
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

ENV WEBAPP_HOST=0.0.0.0 WEBAPP_PORT=5001
EXPOSE 5001

CMD ["python", "webapp.py"]
