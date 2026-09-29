# The build: the dependencies and the sources, compiled
FROM node:22-alpine AS build
WORKDIR /project
COPY . .
RUN npm ci --no-audit --no-fund && npm run build && npm prune --omit=dev

# The image: the compiled service and its production dependencies, run by an unprivileged user
FROM node:22-alpine
ENV NODE_ENV=production PORT=8080
WORKDIR /project
COPY --from=build --chown=node:node /project /project
USER node
EXPOSE 8080
# Whether the process answers: the dependencies (database, message broker) are not part of it, the service stays up
# while they recover
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "packages/app/build/App.js"]
