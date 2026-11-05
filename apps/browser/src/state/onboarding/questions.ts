import { tabLayoutOf } from "../browser/model";
import { useBrowser } from "../browser/store";
import { QUESTIONS, questionsFor, useOnboarding, type OnboardingStep, type QuestionId } from "./onboarding";

export const keysOf = (step: Exclude<OnboardingStep, "intro">) => QUESTIONS[step].flatMap((q) => q.keys);

export const questionKeys = (id: QuestionId) => Object.values(QUESTIONS).flat().find((q) => q.id === id)?.keys ?? [];

export function useQuestions(step: OnboardingStep) {
  const windowId = useOnboarding((s) => s.windowId);
  useOnboarding((s) => s.draft);
  useOnboarding((s) => s.preset);
  useOnboarding((s) => s.source);
  useBrowser((s) => tabLayoutOf(s, windowId));
  return questionsFor(step);
}
