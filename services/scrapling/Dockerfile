FROM python:3.11-slim
WORKDIR /app

# Playwright'ın Chromium'u system kütüphanelerine bağlıdır; `curl` tek başına
# yeterli değild. Önceki imajda `|| true` ile kurulum hataları yutuluyordu ve
# servis sessizce "Scrapling hatası" dönmeye başlıyordu. Artık kurulum
# başarısız olursa build durur — çalışmayan imaj üretmektense üretmemek iyidir.
RUN apt-get update && apt-get install -y --no-install-recommends \
      curl ca-certificates \
      fonts-liberation libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 \
      libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 \
      libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libasound2 \
 && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
# ÖNEMLİ: Scrapling 0.4.x, StealthyFetcher için Playwright'ın yamalanmış fork'u
# olan `patchright` kullanır. Yalnız `playwright install` yetmez; patchright
# tarayıcıları da kurulmalı. İkisi de kurulmazsa servis çalışır görünür ama
# her istekte 502 döner.
RUN pip install --no-cache-dir -r requirements.txt \
 && python -m playwright install --with-deps chromium \
 && python -m patchright install --with-deps chromium

# Kurulumun gerçekten çalıştığını build sırasında doğrula. `|| true` kaldırıldı:
# eksik bağımlılıkla üretilen bir imaj, çalışmayan servisten daha kötüdür.
RUN python -c "from scrapling.fetchers import StealthyFetcher; print('StealthyFetcher OK')" \
 && python -c "import scrapling, patchright; print('scrapling', scrapling.__version__)"

COPY main.py security.py parsing.py ./

# Token yoksa servis açılmasın: paylaşımlı sır olmadan çağrılabilir bir uç,
# kullanıcı girdiği URL'ye SSRF uygulamak için açık proxy olur.
ENV SCRAPLING_SERVICE_TOKEN=""
ENV CRAWLER_ALLOWED_HOSTS=""
ENV PYTHONUNBUFFERED=1

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8000/health || exit 1

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
