import { NextRequest, NextResponse } from "next/server";
import Groq from "groq-sdk";
import {
  applyMemoryUpdate,
  appendTranscriptEntry,
  FollowupSignal,
  getMemory,
  MemoryUpdate,
  PsychoLayer,
  updateMemory,
} from "@/lib/memory";

const EXTRACT_SYSTEM_PROMPT = `You extract structured updates from a user interview answer.
Return ONLY valid JSON, no markdown, no extra text.

Rules:
- Only include facts explicitly stated in the transcript.
- If information is missing, return null/empty values.
- Do not infer social posts or activities unless the user mentions them.
- If no psycho-tree answer is present, keep psychoTree arrays empty and set hasPsychoTreeAnswer to false.

Output schema:
{
  "user": { "name": string|null, "email": string|null },
  "social": {
    "instagram": {
      "handle": string|null,
      "url": string|null,
      "posts": [{ "text": string, "date": string|null, "url": string|null }]
    },
    "linkedin": {
      "profileUrl": string|null,
      "activities": [{ "text": string, "date": string|null, "url": string|null }]
    }
  },
  "psychoTree": {
    "leaves": [{ "question": string|null, "answer": string, "evidence": string|null, "tags": string[], "confidence": number|null }],
    "branches": [{ "question": string|null, "answer": string, "evidence": string|null, "tags": string[], "confidence": number|null }],
    "trunk": [{ "question": string|null, "answer": string, "evidence": string|null, "tags": string[], "confidence": number|null }],
    "roots": [{ "question": string|null, "answer": string, "evidence": string|null, "tags": string[], "confidence": number|null }]
  },
  "hasPsychoTreeAnswer": boolean
}`;

const FOLLOWUP_SYSTEM_PROMPT = `You decide how the interview should proceed based on the latest answer.
Return ONLY JSON, no markdown, no extra text.

Rules:
- If hasPsychoTreeAnswer is false, choose one of: "double_down", "rephrase", "continue_story".
- If hasPsychoTreeAnswer is true, you may choose "continue_story" or "move_on".
- Respect graduated intimacy: do not move to "roots" unless leaves+branches answers >= 3.

Output schema:
{
  "action": "double_down"|"rephrase"|"continue_story"|"move_on",
  "targetLayer": "leaves"|"branches"|"trunk"|"roots"|"none",
  "rationale": string,
  "suggestedPrompt": string
}`;

function extractJson(raw: string) {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("No JSON object found in response");
  }
  return JSON.parse(raw.slice(start, end + 1));
}

function countLayer(
  memory: Awaited<ReturnType<typeof getMemory>>,
  layer: PsychoLayer
) {
  return memory.psychoTree[layer]?.length ?? 0;
}

export async function POST(request: NextRequest) {
  const groqApiKey = process.env.GROQ_API_KEY;

  try {
    const { sessionId, transcript, conversationHistory = [] } =
      await request.json();

    if (!sessionId || !transcript) {
      return NextResponse.json(
        { error: "Missing sessionId or transcript" },
        { status: 400 }
      );
    }

    const memorySnapshot = await getMemory(sessionId);

    const basePayload = {
      transcript,
      recentContext: conversationHistory,
      memoryHints: {
        name: memorySnapshot.user.name,
        email: memorySnapshot.user.email,
        instagram: memorySnapshot.social.instagram.handle,
        linkedin: memorySnapshot.social.linkedin.profileUrl,
      },
    };

    let extraction: MemoryUpdate = {
      psychoTree: {
        leaves: [],
        branches: [],
        trunk: [],
        roots: [],
      },
      hasPsychoTreeAnswer: false,
    };

    let followup: FollowupSignal = {
      action: "continue_story",
      targetLayer: "none",
      rationale: "Default follow-up.",
      suggestedPrompt: "",
    };

    if (groqApiKey) {
      const groq = new Groq({ apiKey: groqApiKey });

      try {
        const extractResponse = await groq.chat.completions.create({
          model: "llama-3.3-70b-versatile",
          messages: [
            { role: "system", content: EXTRACT_SYSTEM_PROMPT },
            { role: "user", content: JSON.stringify(basePayload) },
          ],
          max_tokens: 800,
          temperature: 0,
        });

        const extractContent =
          extractResponse.choices[0]?.message?.content?.trim() || "";
        extraction = extractJson(extractContent) as MemoryUpdate;
      } catch (error) {
        console.error("Extraction parse error:", error);
      }

      try {
        const followupPayload = {
          transcript,
          recentContext: conversationHistory,
          hasPsychoTreeAnswer: Boolean(extraction.hasPsychoTreeAnswer),
          layerCounts: {
            leaves: countLayer(memorySnapshot, "leaves"),
            branches: countLayer(memorySnapshot, "branches"),
            trunk: countLayer(memorySnapshot, "trunk"),
            roots: countLayer(memorySnapshot, "roots"),
          },
        };

        const followupResponse = await groq.chat.completions.create({
          model: "llama-3.3-70b-versatile",
          messages: [
            { role: "system", content: FOLLOWUP_SYSTEM_PROMPT },
            { role: "user", content: JSON.stringify(followupPayload) },
          ],
          max_tokens: 300,
          temperature: 0.1,
        });

        const followupContent =
          followupResponse.choices[0]?.message?.content?.trim() || "";
        followup = extractJson(followupContent) as FollowupSignal;
      } catch (error) {
        console.error("Followup parse error:", error);
      }
    }

    const updatedMemory = await updateMemory(sessionId, (current) => {
      appendTranscriptEntry(current, {
        role: "user",
        content: transcript,
        timestamp: new Date().toISOString(),
      });
      applyMemoryUpdate(current, extraction);
      current.lastFollowup = followup;
      return current;
    });

    return NextResponse.json({ memory: updatedMemory, followup });
  } catch (error) {
    console.error("Analyze answer error:", error);
    return NextResponse.json(
      { error: "Failed to analyze answer" },
      { status: 500 }
    );
  }
}
