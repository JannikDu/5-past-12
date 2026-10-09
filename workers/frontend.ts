interface FrontendEnvironment { ASSETS:{fetch(request:Request):Promise<Response>}; EVIDENCE:{fetch(request:Request):Promise<Response>} }
/** Same-origin reads reuse the existing evidence Worker and the website's access policy. */
export default {
  async fetch(request:Request,env:FrontendEnvironment):Promise<Response> {
    const url=new URL(request.url);
    if(url.pathname.startsWith('/api/')) {
      if(!['/api/climate-events','/api/climate-assessments'].includes(url.pathname))return Response.json({error:'Not found'},{status:404});
      if(!['GET','OPTIONS'].includes(request.method))return Response.json({error:'Public API is read-only'},{status:405,headers:{Allow:'GET, OPTIONS'}});
      const headers=new Headers(request.headers);headers.delete('Authorization');
      return env.EVIDENCE.fetch(new Request(request.url,{method:request.method,headers}));
    }
    return env.ASSETS.fetch(request);
  }
};
