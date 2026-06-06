import { describe, it, expect } from 'vitest';
import { UsersPage } from '../../src/admin/views/users.js';

describe('UsersPage 模型显示', () => {
  it('未设置模型时应显示"所有模型"', () => {
    const users = [{ name: 'test', apikey: 'sk-test', allowedModels: undefined }];
    const result = String(<UsersPage users={users} models={[{ customModel: 'gpt-4' }]} />);
    expect(result).toContain('所有模型');
  });

  it('allowedModels为空数组时应显示"所有模型"', () => {
    const users = [{ name: 'test', apikey: 'sk-test', allowedModels: [] }];
    const result = String(<UsersPage users={users} models={[{ customModel: 'gpt-4' }]} />);
    expect(result).toContain('所有模型');
  });

  it('1-3个模型时应显示所有模型名称', () => {
    const users = [{ name: 'test', apikey: 'sk-test', allowedModels: ['model1', 'model2'] }];
    const result = String(<UsersPage users={users} models={[{ customModel: 'model1' }, { customModel: 'model2' }]} />);
    expect(result).toContain('model1');
    expect(result).toContain('model2');
    expect(result).not.toContain('等');
  });

  it('超过3个模型时应显示前3个和"等x个模型"', () => {
    const users = [{ name: 'test', apikey: 'sk-test', allowedModels: ['m1', 'm2', 'm3', 'm4'] }];
    const result = String(<UsersPage users={users} models={[{ customModel: 'm1' }, { customModel: 'm2' }, { customModel: 'm3' }, { customModel: 'm4' }]} />);
    expect(result).toContain('m1');
    expect(result).toContain('m2');
    expect(result).toContain('m3');
    expect(result).toContain('等1个模型');
    expect(result).not.toContain('m4');
  });

  it('4个模型时应显示前3个和"等1个模型"', () => {
    const users = [{ name: 'test', apikey: 'sk-test', allowedModels: ['a', 'b', 'c', 'd'] }];
    const result = String(<UsersPage users={users} models={[{ customModel: 'a' }, { customModel: 'b' }, { customModel: 'c' }, { customModel: 'd' }]} />);
    expect(result).toContain('等1个模型');
  });

  it('5个模型时应显示前3个和"等2个模型"', () => {
    const users = [{ name: 'test', apikey: 'sk-test', allowedModels: ['a', 'b', 'c', 'd', 'e'] }];
    const result = String(<UsersPage users={users} models={[{ customModel: 'a' }, { customModel: 'b' }, { customModel: 'c' }, { customModel: 'd' }, { customModel: 'e' }]} />);
    expect(result).toContain('等2个模型');
  });

  it('多个用户应各自显示正确的模型', () => {
    const users = [
      { name: 'user1', apikey: 'sk-1', allowedModels: ['m1'] },
      { name: 'user2', apikey: 'sk-2', allowedModels: ['m2', 'm3', 'm4', 'm5', 'm6'] },
      { name: 'user3', apikey: 'sk-3' },
    ];
    const result = String(<UsersPage users={users} models={[{ customModel: 'm1' }, { customModel: 'm2' }]} />);
    expect(result).toContain('所有模型');
    expect(result).toContain('等2个模型');
  });
});
