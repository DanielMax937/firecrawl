FROM node:18-slim

# Install pnpm
RUN npm install -g pnpm

WORKDIR /usr/src/app

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Install dependencies
RUN pnpm install --frozen-lockfile

COPY . .

ENV PLAYWRIGHT_BROWSERS_PATH=/usr/local/share/playwright

# Install Playwright dependencies (for bundled Chromium mode)
RUN npx playwright install chromium --with-deps

RUN pnpm run build

ARG PORT
ENV PORT=${PORT}

# Default to bundled Chromium mode in Docker (not system Chrome)
ENV USE_SYSTEM_CHROME=false

EXPOSE ${PORT}

CMD [ "pnpm", "start" ]
