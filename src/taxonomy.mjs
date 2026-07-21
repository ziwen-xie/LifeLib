const semanticFamilies = [
  ["visual-media", ["image", "images", "photo", "photos", "photography", "picture", "video", "audio", "media"]],
  ["learning", ["academic", "course", "education", "guideline", "lecture", "learning", "school", "syllabus", "textbook", "writing"]],
  ["science", ["biology", "biomedical", "data", "experiment", "lab", "physics", "research", "science", "scientific"]],
  ["work", ["business", "client", "meeting", "planning", "project", "proposal", "work"]],
  ["finance", ["accounting", "budget", "expense", "finance", "invoice", "payment", "receipt", "tax"]],
  ["legal", ["agreement", "contract", "legal", "policy", "terms"]],
  ["personal", ["family", "health", "medical", "personal", "travel", "trip"]],
  ["software", ["application", "code", "computer", "installer", "program", "software"]],
];

const words = (value) => new Set(String(value).toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 2));

function familyNames(value) {
  const tokens = words(value);
  return new Set(semanticFamilies.filter(([, terms]) => terms.some((term) => tokens.has(term))).map(([name]) => name));
}

export function normalizeCategoryRange(minimum, maximum) {
  const max = Math.max(3, Math.min(30, Math.round(Number(maximum) || 15)));
  const min = Math.max(2, Math.min(max, Math.round(Number(minimum) || 10)));
  return { min, max };
}

export function categoryAffinity(source, target) {
  const a = words(source);
  const b = words(target);
  const sharedWords = [...a].filter((word) => b.has(word)).length;
  const aFamilies = familyNames(source);
  const targetFamilies = familyNames(target);
  const sharedFamilies = [...aFamilies].filter((family) => targetFamilies.has(family)).length;
  return sharedWords * 4 + sharedFamilies * 3;
}

export function closestCategory(source, candidates, categorySizes = new Map()) {
  return [...candidates].sort((a, b) => {
    const affinityDifference = categoryAffinity(source, b) - categoryAffinity(source, a);
    if (affinityDifference) return affinityDifference;
    const sizeDifference = (categorySizes.get(b) || 0) - (categorySizes.get(a) || 0);
    return sizeDifference || a.localeCompare(b);
  })[0] || "General";
}
