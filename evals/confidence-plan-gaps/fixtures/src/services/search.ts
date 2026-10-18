export async function search(q: string): Promise<string[]> {
  return q ? [`result for ${q}`] : [];
}
