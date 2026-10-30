import { it, expect } from 'vitest';
import { defaults, settingsSchema, updatePerformance, performancePreferences } from '../src/core/settings.js';
import { applyProfile } from '../src/shared/performance.js';
import { Registry } from '../src/sources/registry.js';

it('preserves legacy preferences and their effective global request limit',()=>{
    const legacy={downloadRoot:'C:/Manga',format:'folders',globalChapters:2,sourceChapters:{mangadex:1},pageRequests:1,port:43110,startWithWindows:false,publicUrl:'',trustTunnel:false};
    const migrated=settingsSchema.parse(legacy);
    expect(migrated).toMatchObject(legacy);
    expect(migrated.performanceProfile).toBe('custom');expect(migrated.globalPageRequests??migrated.pageRequests).toBe(1);
});
it('applies profiles only when selected and caps source settings',()=>{
    const settings=defaults('C:/Manga'), sources=new Registry().manifests();
    applyProfile(settings,'fast',sources);
    expect(settings).toMatchObject({globalChapters:5,pageRequests:10,globalPageRequests:30,performanceProfile:'fast'});
    expect(settings.sourcePageRequests!.mangafreak).toBe(6);
    applyProfile(settings,'conservative',sources);expect(settings).toMatchObject({globalChapters:1,pageRequests:2,globalPageRequests:2});
    settings.pageRequests=7;applyProfile(settings,'custom',sources);expect(settings.pageRequests).toBe(7);
});
it('restricts remotely editable preferences and validates bounds',()=>{
    const settings=defaults('C:/Manga');
    expect(()=>updatePerformance(settings,{downloadRoot:'C:/Other'})).toThrow('Invalid');
    for(const update of [{globalChapters:9},{pageRequests:100},{globalPageRequests:100},{retryAttempts:-1},{sourceIntervals:{fixture:-1}},{browserAssisted:'yes'}])expect(()=>updatePerformance(settings,update)).toThrow();
    expect(updatePerformance(settings,{pageRequests:10})).toMatchObject({pageRequests:10,downloadRoot:'C:/Manga'});
    expect(performancePreferences(settings)).not.toHaveProperty('downloadRoot');
});
