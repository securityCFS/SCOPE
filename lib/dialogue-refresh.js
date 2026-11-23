// Refresh the same session in place. Clearing data here unmounts media while
// every SSE update waits for another /api/dialogue response.
export function beginDialogueRefresh(current, key) {
  return {
    key,
    loading: true,
    data: current.key === key ? current.data : null,
    error: "",
  };
}

export function failDialogueRefresh(current, key, error) {
  return { ...beginDialogueRefresh(current, key), loading: false, error };
}
