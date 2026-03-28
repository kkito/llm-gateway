import { Hono } from 'hono';
import { StatsView } from '../views/stats.js';
import { getCurrentUser } from '../middleware/auth.js';
import { loadStats } from '../../lib/stats-core.js';

export const statsRoute = new Hono();

statsRoute.get('/', (c) => {
  const currentUser = getCurrentUser(c);
  if (!currentUser) {
    return c.redirect('/user/login');
  }

  const stats = loadStats('./logs/proxy', { userName: currentUser.name });

  return c.html(<StatsView stats={stats} userName={currentUser.name} />);
});
