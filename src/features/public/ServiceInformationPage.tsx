import { useEffect } from 'react';
import { BrandLogo } from '../../components/BrandLogo';
import './public-site.css';

const INFORMATION = {
  '/conditions': {
    title: 'Conditions d’utilisation du pilote',
    sections: [
      ['Périmètre', 'Cartularia est actuellement présenté comme un pilote. La démonstration contient des données fictives et est en lecture seule. Les espaces privés permettent de documenter des objets ; ils ne constituent ni une expertise, ni une garantie d’assurance, ni un titre de propriété.'],
      ['Vos accès et vos documents', 'Utilisez un pseudonyme et conservez des mots de passe distincts pour le Registre et le Coffre. Ne communiquez ni mot de passe ni kit de secours à un interlocuteur. Vous devez disposer des droits nécessaires sur les contenus que vous ajoutez ou partagez.'],
      ['Partage choisi', 'Une publication rend les contenus sélectionnés accessibles à ses destinataires, éventuellement à toute personne disposant du lien. Vérifiez les informations présentes dans chaque fichier. Un retrait ne peut pas effacer les copies déjà téléchargées par des tiers.'],
      ['Conservation et disponibilité', 'Conservez vos originaux dans un lieu indépendant. Aucun engagement contractuel de durée de conservation, de capacité ou de disponibilité n’est annoncé pour ce pilote. Les fonctions et leurs limites sont détaillées sur la page Disponibilité et limites.'],
      ['Informations à compléter avant une offre définitive', 'Les conditions commerciales définitives et les mentions juridiques complètes de l’éditeur ne sont pas publiées à ce stade. Cette page décrit le fonctionnement du pilote ; elle ne vaut pas validation juridique de conditions générales définitives. Pour toute précision, utilisez le contact indiqué ci-dessous.'],
    ],
  },
  '/confidentialite': {
    title: 'Confidentialité et données',
    sections: [
      ['Trois espaces distincts', 'Le Registre contient les dossiers d’objets et leurs droits. Le Coffre personnel conserve le contenu personnel sous forme chiffrée dans un projet séparé. Le pont de correspondance conserve des références codées. La séparation ne dispense pas de vérifier vos pièces jointes : une facture ou une photographie peut elle-même contenir des données personnelles.'],
      ['Connexion et conservation locale', 'L’authentification et le stockage distant utilisent Firebase. Le navigateur peut conserver l’état de connexion et des données nécessaires au fonctionnement des dossiers. Le contenu personnel du Coffre est déchiffré pendant son utilisation ; verrouillez-le sur un appareil partagé.'],
      ['Publication', 'Les contenus explicitement publiés deviennent accessibles selon le mode de partage choisi. Ils sont distincts des données privées. Retirer une publication ne retire pas les fichiers déjà obtenus par un destinataire.'],
      ['Contact', 'Le formulaire de contact prépare un email dans votre messagerie : le site n’envoie pas lui-même votre demande. Les champs ne sont transmis à l’équipe que si vous envoyez cet email. Ne joignez pas d’identité sensible, de secret ou de dossier patrimonial confidentiel.'],
      ['Demandes et limites du pilote', 'Pour une question concernant vos données, un export ou une suppression, contactez l’équipe sans communiquer vos secrets. Les identités juridiques complètes du responsable, les durées de conservation définitives et les informations réglementaires détaillées restent à finaliser avant une offre définitive. N’utilisez pas ce pilote comme unique dépositaire de documents importants.'],
    ],
  },
  '/accessibilite': {
    title: 'Accessibilité',
    sections: [
      ['État actuel', 'Les corrections portent notamment sur la navigation mobile, les noms des commandes, le clavier, les dialogues et la lisibilité. Aucune certification ni conformité WCAG complète n’est revendiquée à ce stade.'],
      ['Utilisation', 'Le lien Aller au contenu principal permet de sauter la navigation de l’accueil. Les menus et dialogues proposent des commandes de fermeture ; les formulaires associent leurs champs à des libellés. Vous pouvez agrandir les pages avec le zoom du navigateur.'],
      ['Signaler un obstacle', 'Indiquez la page, votre navigateur, l’appareil et l’action inaccessible à l’équipe. Ne joignez pas de données privées ; une description ou une capture anonymisée suffit.'],
    ],
  },
  '/service': {
    title: 'Disponibilité et limites',
    sections: [
      ['Découvrir', 'La démonstration est accessible sans frais ni inscription et utilise des objets fictifs. Le Registre démo est un compte partagé strictement en lecture seule : il ne permet pas de créer, modifier ou publier des objets réels.'],
      ['Fonctions proposées', 'Cartularia organise les dossiers, les Collections, les médias, le suivi et le partage sélectif. Les états de sauvegarde, de synchronisation et de publication doivent être vérifiés dans chaque espace. Les profils métier disponibles sont ceux proposés à la création ; les autres types ne doivent pas être présumés pris en charge.'],
      ['Tarifs et capacité', 'Aucun paiement en ligne n’est proposé dans cette version. Les offres définitives, quotas contractuels, volumes garantis et durées de conservation ne sont pas encore annoncés. L’absence de tarif publié n’est pas une promesse de stockage illimité ou de gratuité permanente.'],
      ['Exporter et conserver', 'Téléchargez vos médias disponibles et conservez une copie indépendante de vos originaux. La synthèse utilise la fonction Imprimer / Enregistrer en PDF de votre navigateur. Vérifiez le fichier obtenu avant de le transmettre.'],
      ['Ce que le service ne garantit pas', 'Le dossier ne remplace pas une expertise physique, un acte juridique ou les conditions de votre assureur. L’intégrité d’un fichier ne démontre pas à elle seule l’authenticité de l’objet, son propriétaire ou la véracité des déclarations.'],
    ],
  },
} as const;

export function ServiceInformationPage() {
  const page = INFORMATION[window.location.pathname.replace(/\/$/, '') as keyof typeof INFORMATION] || INFORMATION['/service'];
  useEffect(() => { document.title = `${page.title} · Cartularia`; }, [page]);
  return <div className="account-access-page service-information-page">
    <header className="account-access-header"><BrandLogo href="/" /><a href="/">Retour à l’accueil</a></header>
    <main id="main-content">
      <p className="public-kicker">Information du pilote · 6 septembre 2026</p>
      <h1>{page.title}</h1>
      <nav aria-label="Informations sur le service">{Object.entries(INFORMATION).map(([href, item]) => <a key={href} href={href} aria-current={item === page ? 'page' : undefined}>{item.title}</a>)}</nav>
      {page.sections.map(([title, text]) => <section key={title}><h2>{title}</h2><p>{text}</p></section>)}
      <p>Contact : <a href="mailto:contact@cartularia.com">contact@cartularia.com</a> — <a href="/#contact">préparer un message</a>.</p>
      <a href="/account/create">Revenir à la création d’accès</a>
    </main>
  </div>;
}
