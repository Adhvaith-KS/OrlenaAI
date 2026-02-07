"use client";

import { motion } from 'framer-motion';

export default function ParticleSparkles() {
    const particles = [
        { id: 1, delay: 0, x: -30, y: -20 },
        { id: 2, delay: 1.5, x: 40, y: -30 },
        { id: 3, delay: 3, x: -20, y: 30 },
        { id: 4, delay: 4.5, x: 35, y: 25 },
    ];

    return (
        <div className="absolute inset-0 pointer-events-none">
            {particles.map((particle) => (
                <motion.div
                    key={particle.id}
                    className="absolute top-1/2 left-1/2 w-1 h-1 rounded-full bg-indigo-400/40"
                    initial={{ opacity: 0, x: 0, y: 0 }}
                    animate={{
                        opacity: [0, 0.6, 0.3, 0.6, 0],
                        x: [0, particle.x, particle.x * 0.7, particle.x * 1.2, 0],
                        y: [0, particle.y, particle.y * 1.3, particle.y * 0.8, 0],
                    }}
                    transition={{
                        duration: 6,
                        repeat: Infinity,
                        delay: particle.delay,
                        ease: "easeInOut",
                    }}
                />
            ))}
        </div>
    );
}
