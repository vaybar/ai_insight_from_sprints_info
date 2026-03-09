import { GoogleGenAI } from "@google/genai";
import { SprintData } from "../types";

const apiKey = process.env.GEMINI_API_KEY || "";
const ai = new GoogleGenAI({ apiKey });

export interface AnalysisFile {
  mimeType: string;
  data: string; // base64
}

export async function analyzeSprintData(
  data: SprintData[], 
  complementaryInfo?: string,
  files?: AnalysisFile[]
): Promise<string> {
  const model = "gemini-3.1-pro-preview";
  
  const textPart = {
    text: `
      Analyze the following sprint data for a development team.
      Data: ${JSON.stringify(data)}
      
      ${complementaryInfo ? `Additional Context/Information provided by the user: ${complementaryInfo}` : ""}
      
      The data includes:
      - Member name
      - Role
      - Sprint number
      - Story points accumulated
      - Contribution percentage
      
      Please provide:
      1. A summary of overall team performance.
      2. Identification of any bottlenecks or imbalances in workload distribution.
      3. Specific insights per role (e.g., are developers overloaded? are designers underutilized?).
      4. Actionable recommendations to improve efficiency in future sprints.
      
      Format the response in Markdown.
    `
  };

  const parts: any[] = [textPart];

  if (files && files.length > 0) {
    files.forEach(file => {
      parts.push({
        inlineData: {
          mimeType: file.mimeType,
          data: file.data
        }
      });
    });
  }

  try {
    const response = await ai.models.generateContent({
      model,
      contents: { parts },
    });
    return response.text || "No analysis generated.";
  } catch (error) {
    console.error("Error analyzing sprint data:", error);
    return "Error generating analysis. Please check your API key and try again.";
  }
}
