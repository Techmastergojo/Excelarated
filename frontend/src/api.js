import axios from 'axios'

const BASE = '/api'

const api = axios.create({ baseURL: BASE })

export const listFiles      = ()           => api.get('/files').then(r => r.data)
export const uploadFile     = (form)       => api.post('/upload', form).then(r => r.data)
export const deleteFile     = (fname)      => api.delete(`/file/${fname}`).then(r => r.data)
export const getMetadata    = (fname)      => api.get(`/file/${fname}/metadata`).then(r => r.data)
export const downloadFile   = (fname)      => `${BASE}/file/${fname}/download`

export const mergeFiles     = (body)       => api.post('/merge', body).then(r => r.data)
export const cleanData      = (body)       => api.post('/clean', body).then(r => r.data)
export const queryData      = (body)       => api.post('/query', body).then(r => r.data)
export const saveData       = (body)       => api.post('/save', body).then(r => r.data)
export const trainModel     = (body)       => api.post('/train', body).then(r => r.data)

export default api
