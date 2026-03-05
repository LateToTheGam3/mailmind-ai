document.addEventListener('DOMContentLoaded', async () => {
    const { apiKey } = await chrome.storage.sync.get('apiKey');
    if (apiKey) document.getElementById('apiKey').value = apiKey;
});

document.getElementById('save').addEventListener('click', async () => {
    const key = document.getElementById('apiKey').value.trim();
    await chrome.storage.sync.set({ apiKey: key });
    document.getElementById('status').textContent = '✓ Saved!';
    setTimeout(() => document.getElementById('status').textContent = '', 2000);
});