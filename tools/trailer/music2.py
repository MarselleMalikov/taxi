import numpy as np, wave
SR=44100; BPM=150; BEAT=60/BPM; DROP=2.0; DUR=28.0+0.6
N=int(SR*DUR); L=np.zeros(N); R=np.zeros(N)
rng=np.random.default_rng(7)
def add(sig,t,gl=1.0,gr=None):
    if gr is None: gr=gl
    i=int(t*SR)
    if i>=N or i<0: return
    n=min(len(sig),N-i); L[i:i+n]+=sig[:n]*gl; R[i:i+n]+=sig[:n]*gr
def env(n,a=0.005,d=0.2,curve=4.0):
    t=np.arange(n)/SR; e=np.exp(-t/d*curve/4); at=np.minimum(1,t/a); return e*at
def lp(x,fc):
    a=np.exp(-2*np.pi*fc/SR); y=np.empty_like(x); z=0.0
    b=1-a
    for i in range(len(x)): z=b*x[i]+a*z; y[i]=z
    return y
def lp_fast(x,fc,order=2):
    # one-pole via FFT-domain response (fast)
    X=np.fft.rfft(x); f=np.fft.rfftfreq(len(x),1/SR); H=1/(1+(f/fc)**2)**(order/2); return np.fft.irfft(X*H,len(x))
def hp_fast(x,fc,order=2):
    X=np.fft.rfft(x); f=np.fft.rfftfreq(len(x),1/SR); H=((f/fc)**2/(1+(f/fc)**2))**(order/2); return np.fft.irfft(X*H,len(x))
def kick(amp=1.0):
    n=int(SR*0.32); t=np.arange(n)/SR; f=48+110*np.exp(-t*38); ph=2*np.pi*np.cumsum(f)/SR
    s=np.sin(ph)*np.exp(-t*11); s+=0.25*np.exp(-t*400)*rng.standard_normal(n)*0.3; return np.tanh(s*1.8)*amp
def clap(amp=1.0):
    n=int(SR*0.22); t=np.arange(n)/SR; x=rng.standard_normal(n)
    e=np.zeros(n)
    for d in (0,0.011,0.022): e+=np.where(t>=d,np.exp(-(t-d)*55),0)
    e+=np.exp(-t*18)*0.5
    return hp_fast(lp_fast(x*e,6500),900)*amp*0.6
def hat(amp=1.0,d=0.03):
    n=int(SR*0.12); t=np.arange(n)/SR; x=rng.standard_normal(n)*np.exp(-t/d); return hp_fast(x,7000)*amp*0.35
def saw(f,n,det=0.0):
    t=np.arange(n)/SR; s=np.zeros(n)
    for k,dd in enumerate((-det,0,det)):
        ph=(t*f*(1+dd)+0.33*k)%1.0; s+=2*ph-1
    return s/3
def note(m): return 440*2**((m-69)/12)
def pluck(m,dur=0.22,amp=1.0,bright=3200):
    n=int(SR*(dur+0.25)); s=saw(note(m),n,0.004)+0.5*np.sin(2*np.pi*note(m)*np.arange(n)/SR)
    s=lp_fast(s,bright); return s*env(n,0.003,dur,5)*amp
def bass(m,dur,amp=1.0):
    n=int(SR*dur); t=np.arange(n)/SR; f=note(m); s=np.sin(2*np.pi*f*t)+0.35*lp_fast(saw(f,n),500)
    e=np.minimum(1,t/0.008)*np.minimum(1,(dur-t)/0.03); return np.tanh(s*1.3)*e*amp
def pad(ms,dur,amp=1.0):
    n=int(SR*dur); s=np.zeros(n)
    for m in ms: s+=saw(note(m),n,0.006)
    s=lp_fast(s,1500); t=np.arange(n)/SR; e=np.minimum(1,t/0.25)*np.minimum(1,(dur-t)/0.3); return s*e*amp/len(ms)
def noise_sweep(dur,up=True,amp=1.0):
    n=int(SR*dur); x=rng.standard_normal(n); t=np.arange(n)/n
    X=np.fft.rfft(x); out=np.zeros(n); K=24
    seg=n//K
    for k in range(K):
        u=(k+0.5)/K; fc=300*(40)**(u if up else 1-u)
        y=hp_fast(lp_fast(x[k*seg:(k+1)*seg],fc*1.6),fc*0.6); out[k*seg:k*seg+len(y)]=y
    e=(t**2 if up else (1-t)**2); return out*e*amp
def ding(f=1320,amp=1.0,dur=0.5):
    n=int(SR*dur); t=np.arange(n)/SR; s=np.sin(2*np.pi*f*t)+0.4*np.sin(2*np.pi*f*2.01*t)+0.15*np.sin(2*np.pi*f*3.0*t); return s*np.exp(-t*9)*np.minimum(1,t/0.002)*amp*0.3
def click(amp=1.0):
    n=int(SR*0.05); t=np.arange(n)/SR; return (np.sin(2*np.pi*1900*t)*np.exp(-t*120)+0.3*rng.standard_normal(n)*np.exp(-t*300))*amp*0.3
# ---------- гармония: Am F C G (такт = 1.6 c) ----------
CH=[(57,[69,72,76]),(53,[69,72,77]),(48,[67,72,76]),(55,[67,71,74])]
ARP=[0,1,2,1,0,2,1,2]
side=np.ones(N)
def sc(t,depth=0.55,rel=0.2):
    i=int(t*SR); n=int(rel*SR)
    if i>=N: return
    k=np.arange(min(n,N-i))/n; side[i:i+len(k)]=np.minimum(side[i:i+len(k)],1-depth*(1-k)**1.5)
mus=np.zeros(N); musR=np.zeros(N)
def addm(sig,t,gl=1.0,gr=None):
    if gr is None: gr=gl
    i=int(t*SR)
    if i>=N: return
    n=min(len(sig),N-i); mus[i:i+n]+=sig[:n]*gl; musR[i:i+n]+=sig[:n]*gr
F=lambda f:f/30
# вступление: удары под слова, счётчик, нарастание
for k,t in enumerate((F(2),F(14),F(26))):
    add(kick(0.9),t); add(pluck(69 if k<2 else 76,0.4,0.5,2500),t,0.9,0.7); addm(pad([57,64,69],0.4,0.25),t)
for i in range(12): add(ding(1400+i*120,0.28,0.12),F(32)+i*0.07)
add(noise_sweep(1.1,True,0.5),DROP-1.15)
for i,t in enumerate(np.arange(DROP-0.8,DROP-0.01,0.1)): add(clap(0.22+0.07*i),t)
bars=14
for b in range(bars):
    t0=DROP+b*4*BEAT; root,tri=CH[b%4]
    light=b<2; brk=b in (10,11) and False
    night=(b==10) or (b==11)   # ночная сцена: без бочки первую половину, потом разгон
    hot=b>=12
    addm(pad([root+12]+tri,4*BEAT,0.42),t0)
    for q in range(4):
        tb=t0+q*BEAT
        quiet=47<=(b*4+q+5)<=50
        if not quiet:
            add(kick(1.0),tb); sc(tb)
            if q%2==1: add(clap(0.9 if not light else 0.6),tb,0.95,1.0)
        else:
            if q%2==1: add(clap(0.45),tb)
        if not light: add(hat(0.55),tb+BEAT/2,0.8,1.0)
        if hot or (b%2==1 and not light):
            add(hat(0.3,0.015),tb+BEAT/4,1.0,0.7); add(hat(0.3,0.015),tb+3*BEAT/4,0.7,1.0)
        br=root-12 if root>50 else root
        if not quiet:
            addm(bass(br,BEAT*0.42,0.8),tb+BEAT/2)
            if q==3 and not light: addm(bass(br+12,BEAT*0.2,0.55),tb+BEAT*0.75)
        else: addm(bass(br,BEAT*0.9,0.5),tb)
    for e in range(8):
        m=tri[ARP[e]]+(12 if e%4==3 else 0)
        pan=0.5+0.35*np.sin(e*1.7); addm(pluck(m,0.17,0.55,3800 if hot else 2900),t0+e*BEAT/2,1-pan*0.6,0.4+pan*0.6)
        if b>=3 and not (47<=(b*4+e//2+5)<=50): addm(pluck(m+12,0.1,0.17,5200),t0+e*BEAT/2+BEAT*0.375,0.5,0.9)
    if hot:
        for e in range(4): addm(pluck(tri[2]+12,0.25,0.3,4500),t0+e*BEAT,0.9,0.6)
    if b==11:
        for i,t in enumerate(np.arange(t0+2*BEAT,t0+4*BEAT-0.01,0.1)): add(clap(0.3+0.05*i),t)
        add(noise_sweep(1.0,True,0.45),t0+4*BEAT-1.0)
    if b==bars-1:
        for i,t in enumerate(np.arange(t0+2*BEAT,t0+4*BEAT-0.01,0.1)): add(clap(0.3+0.05*i),t)
        add(noise_sweep(0.8,True,0.45),t0+4*BEAT-0.8)
# финал
t0=DROP+bars*4*BEAT
add(kick(1.1),t0); sc(t0,0.6,0.35); add(clap(0.8),t0)
addm(pad([45,57,64,69,72,76],3.9,0.9),t0); add(noise_sweep(1.5,False,0.4),t0)
for e,m in enumerate([69,72,76,81,84,88]): addm(pluck(m,0.5,0.5,4200),t0+e*BEAT/2,0.7+0.05*e,1.0-0.05*e)
for q in (2,4): add(kick(0.9),t0+q*BEAT); sc(t0+q*BEAT)
addm(pluck(81,0.8,0.45,4000),t0+4*BEAT); addm(pluck(88,0.8,0.35,4000),t0+4.5*BEAT)
L+=mus*side*0.55; R+=musR*side*0.55
# ---------- звуки событий ----------
def order_ding(t):
    for i,dt in enumerate((0,0.13,0.32,0.45)): add(ding(1568 if i%2==0 else 2093,0.9),t+dt,0.9,1.0)
order_ding(F(95)); order_ding(F(572))
for f in (71,124,299,373,400,445,459,515,531,617,665): add(click(1.0),F(f))
for f in (445,459,515,531): add(ding(1760,0.5,0.2),F(f)+0.02)   # тариф включён / навык прокачан
for i,f0 in enumerate((1976,2637,3136)): add(ding(f0,0.8,0.6),F(323)+i*0.07)
for i in range(6): add(ding(2800+rng.uniform(-300,500),0.35,0.25),F(325)+0.05*i+0.12)
for f in (102,168,228,312,360,432,504,564,636,660,684,708,732): add(noise_sweep(0.2,False,0.22),F(f)-0.02)
n=int(SR*2.4); rn=hp_fast(lp_fast(rng.standard_normal(n),5000),1500); t=np.arange(n)/n; rn*=np.minimum(1,t/0.1)*np.minimum(1,(1-t)/0.15)
add(rn*0.12,F(564),1.0,0.8)
for i in range(7): add(click(0.5),F(665)+0.04+i*0.06)
# ---------- сведение ----------
t=np.arange(N)/SR; fade=np.minimum(1,(DUR-0.05-t)/1.6).clip(0,1); fin=np.minimum(1,t/0.02)
st=np.stack([L,R],1)*fade[:,None]*fin[:,None]
st=np.tanh(st*0.9)/np.tanh(0.9); st*=0.89/np.abs(st).max()
w=wave.open('music2.wav','wb'); w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes((st*32767).astype('<i2').tobytes()); w.close()
print('ok',DUR,np.abs(st).max(),np.sqrt((st**2).mean()))
