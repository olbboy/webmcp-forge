# Playwright's own image, pinned to the version in package.json so the browser
# and the driver never disagree. It already carries the shared libraries a
# headless browser needs, which is the usual reason Chrome fails in a container.
FROM mcr.microsoft.com/playwright:v1.63.0-noble

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

COPY package.json package-lock.json ./
# The full install: `next build` needs TypeScript and Tailwind, which are dev
# dependencies. They are pruned again after the build.
RUN npm ci

# Real Google Chrome, not the bundled Chromium, because the scanner asks for
# `channel: "chrome"`. Installing it here makes production take the same code
# path as local development instead of the fallback branch.
RUN npx playwright install chrome

COPY . .
RUN npm run build && npm prune --omit=dev

ENV NODE_ENV=production
# Jobs live on a mounted volume. Without one, every job is lost on restart.
ENV WEBMCP_DATA_DIR=/data
EXPOSE 43127

CMD ["npm", "start"]
