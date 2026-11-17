import { MAIN, uid, type Conversation, type Msg, type Role } from './types';
import { newConversation } from './io';

/** A small example conversation so the grid layout is visible on first launch. */
export function makeDemo(): Conversation {
  const c = newConversation('Παράδειγμα: από πού ξεκινήσαμε;', 'claude.ai');
  const t0 = Date.now() - 3_600_000;
  let n = 0;
  const msg = (branchId: string, role: Role, text: string): Msg => {
    const m: Msg = { id: uid(), branchId, role, text, createdAt: t0 + n++ * 1000 };
    c.messages.push(m);
    return m;
  };

  msg(MAIN, 'user', 'Θέλω να φτιάξω μια εφαρμογή που να αποθηκεύει τις συζητήσεις με την ΑΙ σε διάταξη σαν Excel, με κάθε μήνυμα σε κελί.');
  msg(MAIN, 'ai', 'Καλή ιδέα. Προτείνω να αποθηκεύουμε δέντρο μηνυμάτων και το grid να είναι απλώς η προβολή του. Έτσι οι διακλαδώσεις είναι φυσικές.');
  const m3 = msg(MAIN, 'user', 'Μου αρέσει. Τι γίνεται όμως όταν θέλω να εξερευνήσω κάτι που είπες χωρίς να χάσω τον ειρμό;');
  const m4 = msg(MAIN, 'ai', 'Κάνεις διακλάδωση από εκείνο το μήνυμα: ανοίγει νέα στήλη δεξιά, με δική της αρίθμηση (π.χ. 3.1, 3.2) και η κύρια ροή συνεχίζεται κανονικά.');
  msg(MAIN, 'user', 'Και αν χρειαστώ και τρίτη κατεύθυνση;');
  msg(MAIN, 'ai', 'Η νεότερη διακλάδωση μπαίνει δίπλα στην κύρια στήλη και οι παλαιότερες μετακινούνται προς τα δεξιά.');

  const b1 = { id: uid(), parentBranchId: MAIN, forkMsgId: m3.id, title: 'Πώς αποθηκεύονται οι διακλαδώσεις;', createdAt: t0 + 100_000 };
  c.branches.push(b1);
  msg(b1.id, 'user', 'Εξήγησέ μου το μοντέλο δεδομένων πιο αναλυτικά.');
  msg(b1.id, 'ai', 'Κάθε διακλάδωση έχει id, γονική διακλάδωση και το μήνυμα από το οποίο ξεκινά. Η αρίθμηση προκύπτει από το μήνυμα-πηγή.');

  const b2 = { id: uid(), parentBranchId: MAIN, forkMsgId: m4.id, title: 'Εξαγωγή αρχείου', createdAt: t0 + 200_000 };
  c.branches.push(b2);
  msg(b2.id, 'user', 'Πώς θα το εξάγω στον υπολογιστή μου;');
  msg(b2.id, 'ai', 'Σε JSON για να ξαναφορτώνεται εδώ, και σε Markdown για να διαβάζεται οπουδήποτε.');

  return c;
}
