# EVI Conversational Agent

A clean, standalone conversational voice AI agent built with Hume's EVI SDK.

## Features

- **PAUSE Mode**: Say "hold on", "wait", "let me think" to pause the assistant
- **SHORT Mode**: Say "quick", "brief", "short" for concise responses
- **DETAILED Mode**: Say "explain", "tell me more", "in depth" for thorough responses
- Real-time emotion detection and display
- Audio visualizer for mic and speaker activity
- Clean, modern UI with transcript

## Setup

1. Copy `env.example` to `.env.local`:
   ```bash
   cp env.example .env.local
   ```

2. Add your Hume API credentials to `.env.local`:
   ```
   HUME_API_KEY=your_api_key_here
   HUME_SECRET_KEY=your_secret_key_here
   ```

3. Install dependencies:
   ```bash
   npm install
   ```

4. Run the development server:
   ```bash
   npm run dev
   ```

5. Open [http://localhost:3005](http://localhost:3005)

## Mode Commands

| Mode | Keywords |
|------|----------|
| PAUSE | "hold on", "wait", "one second", "pause", "give me a moment" |
| SHORT | "quick", "brief", "short", "fast", "concise" |
| DETAILED | "explain", "tell me more", "elaborate", "in depth" |

## Tech Stack

- Next.js 16
- React 18
- Hume AI Voice React SDK
- Framer Motion
- Tailwind CSS
- TypeScript

## Notes

- This project runs on port **3005** to avoid conflicts with other projects
- No custom interruption logic - uses standard Hume SDK handling
- Completely standalone from any other EVI projects

