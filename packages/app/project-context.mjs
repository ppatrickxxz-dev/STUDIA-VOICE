export function sortProjectsByContext(projects = [], activeId = null) {
  return [...projects].sort((a, b) => {
    if (activeId) {
      if (a.id === activeId && b.id !== activeId) return -1;
      if (b.id === activeId && a.id !== activeId) return 1;
    }
    return Number(b.updatedAt || 0) - Number(a.updatedAt || 0);
  });
}
