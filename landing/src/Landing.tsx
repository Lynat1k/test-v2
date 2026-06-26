import { ParallaxBackground } from './components/ParallaxBackground';
import { Marquee } from './components/Marquee';
import { Hero } from './sections/Hero';
import { Showcase } from './sections/Showcase';
import { ReadyToStart } from './sections/ReadyToStart';
import { TwoCharts } from './sections/TwoCharts';
import { Features } from './sections/Features';
import { Infra } from './sections/Infra';
import { FAQ } from './sections/FAQ';
import { Footer } from './sections/Footer';
import logo from './assets/procluster_logo.png';

function Nav() {
  return (
    <header className="sticky top-0 z-40">
      <div className="mx-auto max-w-6xl px-5 py-3">
        <nav className="glass rounded-2xl px-4 sm:px-5 py-2.5 flex items-center justify-between">
          <a href="#" className="flex items-center gap-2.5">
            <img src={logo} alt="ProCluster" className="h-7 w-auto" />
          </a>
          <div className="hidden md:flex items-center gap-7 text-sm text-muted">
            <a href="#features" className="hover:text-white transition-colors">Возможности</a>
            <a href="#faq" className="hover:text-white transition-colors">FAQ</a>
            <a href="#" className="hover:text-white transition-colors">Тарифы</a>
          </div>
          <a href="https://chart.procluster.online" target="_blank" rel="noopener noreferrer" className="term-btn rounded-lg px-4 py-2 text-sm font-display font-semibold">
            Открыть терминал
          </a>
        </nav>
      </div>
    </header>
  );
}

export function Landing() {
  return (
    <div className="relative min-h-screen">
      <ParallaxBackground />
      <Nav />
      <main>
        <Hero />
        <Marquee />
        <Showcase />
        <ReadyToStart />
        <TwoCharts />
        <Features />
        <Infra />
        <FAQ />
      </main>
      <Footer />
    </div>
  );
}
