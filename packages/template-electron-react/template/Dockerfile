# The environment packaging the application for Linux (npm run cross): the tools of electron-builder for the deb
# packages (fpm, as the one it downloads is the one of x64), and the system libraries of the native addons (add yours)
FROM node:22-bookworm
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential python3 ruby ruby-dev fakeroot dpkg rpm \
    && gem install fpm --no-document \
    && rm -rf /var/lib/apt/lists/*
ENV USE_SYSTEM_FPM=true
WORKDIR /project
COPY . .
RUN npm ci --no-audit --no-fund
CMD ["sh", "-c", "npm run package -- --linux deb && cp release/dist/*.deb /output/"]
