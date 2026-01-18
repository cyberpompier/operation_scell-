
import { GoogleGenAI, Type } from "@google/genai";
import { Role } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export async function generateBriefing(role: Role, name: string): Promise<string> {
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `Génère un court message de briefing militaire (max 150 caractères) pour un joueur nommé "${name}" dont le rôle secret est "${role}". Utilise un ton sérieux et opérationnel de sapeur-pompier. Utilise les termes techniques: Neutralisé, Infiltré, Mise à pied, CODIS, Scellé.`,
      config: {
        thinkingConfig: { thinkingBudget: 0 }
      }
    });
    return response.text || "Mission en attente. Restez vigilant.";
  } catch (error) {
    console.error("Gemini Error:", error);
    return "Connexion sécurisée établie. En attente d'ordres.";
  }
}

export async function analyzeIntel(playerName: string, targetName: string): Promise<string> {
    try {
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `Génère un rapport de renseignement CODIS cryptique pour ${playerName} enquêtant sur ${targetName}. Ne révèle pas directement le rôle, mais donne un indice tactique suggérant s'il est un allié ou une menace potentielle (Infiltré).`,
        config: {
          thinkingConfig: { thinkingBudget: 0 }
        }
      });
      return response.text || "Données corrompues. Impossible d'analyser la cible.";
    } catch (error) {
      return "Accès au serveur CODIS restreint.";
    }
}
