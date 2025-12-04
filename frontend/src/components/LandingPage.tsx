import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ArrowRight, Sparkles, Shield, Zap } from 'lucide-react';

interface LandingPageProps {
    onGetStarted: () => void;
}

export const LandingPage = ({ onGetStarted }: LandingPageProps) => {
    return (
        <div className="w-full">
            {/* Hero Section */}
            <section className="relative overflow-hidden bg-gradient-to-b from-primary/5 via-background to-background py-20 md:py-32">
                <div className="container mx-auto px-4">
                    <div className="max-w-4xl mx-auto text-center">
                        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 text-primary text-sm font-medium mb-6">
                            <Sparkles className="h-4 w-4" />
                            <span>Powered by Solana & Metaplex Core</span>
                        </div>

                        <h1 className="text-5xl md:text-7xl font-bold mb-6 bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">
                            Create, Collect & Trade
                            <br />
                            <span className="bg-gradient-to-r from-purple-600 to-pink-600 bg-clip-text text-transparent">
                                Multimedia NFTs
                            </span>
                        </h1>

                        <p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto">
                            The first NFT marketplace on Solana that supports images, videos, and audio with seamless trading and collection management.
                        </p>

                        <div className="flex flex-col sm:flex-row gap-4 justify-center">
                            <Button size="lg" className="text-lg px-8" onClick={onGetStarted}>
                                Get Started
                                <ArrowRight className="ml-2 h-5 w-5" />
                            </Button>
                            <Button size="lg" variant="outline" className="text-lg px-8">
                                Explore Marketplace
                            </Button>
                        </div>
                    </div>
                </div>

                {/* Decorative gradient blobs */}
                <div className="absolute top-0 left-1/4 w-96 h-96 bg-purple-500/20 rounded-full blur-3xl -z-10" />
                <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-pink-500/20 rounded-full blur-3xl -z-10" />
            </section>

            {/* Features Section */}
            <section className="py-20 bg-muted/30">
                <div className="container mx-auto px-4">
                    <div className="text-center mb-16">
                        <h2 className="text-3xl md:text-4xl font-bold mb-4">Why Choose Kumele?</h2>
                        <p className="text-muted-foreground text-lg">Built for creators, collectors, and traders</p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-6xl mx-auto">
                        <Card className="border-2 hover:border-primary/50 transition-colors">
                            <CardContent className="pt-6">
                                <div className="h-12 w-12 rounded-lg bg-purple-500/10 flex items-center justify-center mb-4">
                                    <Sparkles className="h-6 w-6 text-purple-600" />
                                </div>
                                <h3 className="text-xl font-semibold mb-2">Multimedia Support</h3>
                                <p className="text-muted-foreground">
                                    Upload and trade images, videos, and audio NFTs with cover art support. Full multimedia experience.
                                </p>
                            </CardContent>
                        </Card>

                        <Card className="border-2 hover:border-primary/50 transition-colors">
                            <CardContent className="pt-6">
                                <div className="h-12 w-12 rounded-lg bg-blue-500/10 flex items-center justify-center mb-4">
                                    <Zap className="h-6 w-6 text-blue-600" />
                                </div>
                                <h3 className="text-xl font-semibold mb-2">Lightning Fast</h3>
                                <p className="text-muted-foreground">
                                    Built on Solana for instant transactions and minimal fees. Trade NFTs in seconds, not minutes.
                                </p>
                            </CardContent>
                        </Card>

                        <Card className="border-2 hover:border-primary/50 transition-colors">
                            <CardContent className="pt-6">
                                <div className="h-12 w-12 rounded-lg bg-green-500/10 flex items-center justify-center mb-4">
                                    <Shield className="h-6 w-6 text-green-600" />
                                </div>
                                <h3 className="text-xl font-semibold mb-2">Secure & Decentralized</h3>
                                <p className="text-muted-foreground">
                                    Your NFTs, your keys. All transactions are on-chain with atomic swaps for secure trading.
                                </p>
                            </CardContent>
                        </Card>
                    </div>
                </div>
            </section>

            {/* Stats Section */}
            <section className="py-20">
                <div className="container mx-auto px-4">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-8 max-w-4xl mx-auto">
                        <div className="text-center">
                            <div className="text-4xl font-bold text-primary mb-2">1000+</div>
                            <div className="text-muted-foreground">NFTs Minted</div>
                        </div>
                        <div className="text-center">
                            <div className="text-4xl font-bold text-primary mb-2">500+</div>
                            <div className="text-muted-foreground">Collections</div>
                        </div>
                        <div className="text-center">
                            <div className="text-4xl font-bold text-primary mb-2">50+</div>
                            <div className="text-muted-foreground">Creators</div>
                        </div>
                        <div className="text-center">
                            <div className="text-4xl font-bold text-primary mb-2">100%</div>
                            <div className="text-muted-foreground">Decentralized</div>
                        </div>
                    </div>
                </div>
            </section>

            {/* CTA Section */}
            <section className="py-20 bg-gradient-to-r from-purple-600/10 to-pink-600/10">
                <div className="container mx-auto px-4">
                    <div className="max-w-3xl mx-auto text-center">
                        <h2 className="text-3xl md:text-4xl font-bold mb-4">Ready to Start Your NFT Journey?</h2>
                        <p className="text-muted-foreground text-lg mb-8">
                            Connect your wallet and start creating, collecting, or trading multimedia NFTs today.
                        </p>
                        <Button size="lg" className="text-lg px-8" onClick={onGetStarted}>
                            Launch App
                            <ArrowRight className="ml-2 h-5 w-5" />
                        </Button>
                    </div>
                </div>
            </section>
        </div>
    );
};
