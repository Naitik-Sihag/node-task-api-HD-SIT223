const request = require('supertest');
const app = require('../src/app');

describe('Health Check', () => {
  test('GET /health returns 200', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});

describe('Tasks API', () => {
  test('GET /tasks returns empty array initially', async () => {
    const res = await request(app).get('/tasks');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.tasks)).toBe(true);
  });

  test('POST /tasks creates a task', async () => {
    const res = await request(app).post('/tasks').send({ title: 'Test Task', priority: 'high' });
    expect(res.status).toBe(201);
    expect(res.body.title).toBe('Test Task');
    expect(res.body.priority).toBe('high');
    expect(res.body.id).toBeDefined();
  });

  test('POST /tasks returns 400 without title', async () => {
    const res = await request(app).post('/tasks').send({ description: 'No title' });
    expect(res.status).toBe(400);
  });

  test('GET /tasks/:id retrieves a task', async () => {
    const post = await request(app).post('/tasks').send({ title: 'Find Me' });
    const res = await request(app).get(`/tasks/${post.body.id}`);
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Find Me');
  });

  test('GET /tasks/:id returns 404 for unknown id', async () => {
    const res = await request(app).get('/tasks/99999');
    expect(res.status).toBe(404);
  });

  test('PUT /tasks/:id updates a task', async () => {
    const post = await request(app).post('/tasks').send({ title: 'Update Me' });
    const res = await request(app).put(`/tasks/${post.body.id}`).send({ completed: true });
    expect(res.status).toBe(200);
    expect(res.body.completed).toBe(true);
  });

  test('DELETE /tasks/:id deletes a task', async () => {
    const post = await request(app).post('/tasks').send({ title: 'Delete Me' });
    const res = await request(app).delete(`/tasks/${post.body.id}`);
    expect(res.status).toBe(200);
  });

  test('DELETE /tasks/:id returns 404 for unknown id', async () => {
    const res = await request(app).delete('/tasks/99999');
    expect(res.status).toBe(404);
  });
});
