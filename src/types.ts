export interface SprintData {
  member: string;
  role: string;
  sprint: string;
  storyPoints: number;
  contributionPercentage: number;
}

export interface AnalysisResult {
  insights: string;
  recommendations: string[];
}
